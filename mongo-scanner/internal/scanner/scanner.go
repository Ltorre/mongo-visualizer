package scanner

import (
	"context"
	"fmt"
	"regexp"
	"sync"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"mongo-scanner/internal/analyzer"
	"mongo-scanner/internal/logger"
	"mongo-scanner/internal/types"
)

// Scanner handles MongoDB schema scanning
type Scanner struct {
	client  *mongo.Client
	options types.ScanOptions
	log     *logger.Logger
}

// NewScanner creates a new MongoDB scanner
func NewScanner(opts types.ScanOptions, log *logger.Logger) (*Scanner, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clientOpts := options.Client().ApplyURI(opts.URI)
	client, err := mongo.Connect(ctx, clientOpts)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to MongoDB: %w", err)
	}

	// Verify connection
	if err := client.Ping(ctx, nil); err != nil {
		return nil, fmt.Errorf("failed to ping MongoDB: %w", err)
	}

	log.Info("Successfully connected to MongoDB")

	return &Scanner{
		client:  client,
		options: opts,
		log:     log,
	}, nil
}

// Close disconnects from MongoDB
func (s *Scanner) Close(ctx context.Context) error {
	return s.client.Disconnect(ctx)
}

// ScanAll scans all accessible databases
func (s *Scanner) ScanAll(ctx context.Context) (*types.ScanResult, error) {
	// Get cluster name from connection
	clusterName := s.extractClusterName()

	// List all databases. SizeOnDisk is the metric used by mongosh's
	// show databases output. dbStats.dataSize is logical/uncompressed data
	// and can differ significantly on compressed storage engines.
	databaseResult, err := s.client.ListDatabases(ctx, bson.M{})
	if err != nil {
		return nil, fmt.Errorf("failed to list databases: %w", err)
	}
	databases := make([]string, 0, len(databaseResult.Databases))
	databaseSizes := make(map[string]int64, len(databaseResult.Databases))
	for _, database := range databaseResult.Databases {
		databases = append(databases, database.Name)
		databaseSizes[database.Name] = database.SizeOnDisk
	}

	// Filter databases if specified
	databases = s.filterDatabases(databases)

	s.log.Info("Found %d databases to scan", len(databases))

	result := &types.ScanResult{
		SchemaVersion: 2,
		ClusterName:   clusterName,
		ScanTimestamp: time.Now().UTC().Format(time.RFC3339),
		Databases:     make([]types.Database, 0, len(databases)),
	}

	// Scan databases concurrently
	var wg sync.WaitGroup
	var mu sync.Mutex
	semaphore := make(chan struct{}, s.options.Concurrency)

	for _, dbName := range databases {
		// Skip system databases
		if dbName == "admin" || dbName == "local" || dbName == "config" {
			s.log.Debug("Skipping system database: %s", dbName)
			continue
		}

		wg.Add(1)
		go func(dbName string) {
			defer wg.Done()
			semaphore <- struct{}{}
			defer func() { <-semaphore }()

			dbSchema, err := s.scanDatabase(ctx, dbName, databaseSizes[dbName])
			if err != nil {
				s.log.Error("Error scanning database %s: %v", dbName, err)
				return
			}

			mu.Lock()
			result.Databases = append(result.Databases, *dbSchema)
			mu.Unlock()
		}(dbName)
	}

	wg.Wait()

	s.log.Info("Scan completed. Processed %d databases", len(result.Databases))
	return result, nil
}

// ScanDatabase scans a specific database
func (s *Scanner) ScanDatabase(ctx context.Context, dbName string) (*types.Database, error) {
	s.log.Info("Scanning database: %s", dbName)

	databaseResult, err := s.client.ListDatabases(ctx, bson.M{})
	if err != nil {
		return nil, fmt.Errorf("failed to list databases: %w", err)
	}
	for _, database := range databaseResult.Databases {
		if database.Name == dbName {
			return s.scanDatabase(ctx, dbName, database.SizeOnDisk)
		}
	}

	return nil, fmt.Errorf("database %s was not found", dbName)
}

func (s *Scanner) scanDatabase(ctx context.Context, dbName string, sizeOnDisk int64) (*types.Database, error) {
	s.log.Info("Scanning database: %s", dbName)

	db := s.client.Database(dbName)

	// Keep the logical data size as a second metric. This is what the old
	// scanner stored, while sizeOnDisk is what mongosh show databases uses.
	var dbStats bson.M
	if err := db.RunCommand(ctx, bson.D{{Key: "dbStats", Value: 1}}).Decode(&dbStats); err != nil {
		s.log.Warn("Could not get logical stats for database %s: %v", dbName, err)
	}
	dataSize, _ := bsonInt64(dbStats["dataSize"])

	// List collections
	collections, err := db.ListCollectionNames(ctx, bson.M{})
	if err != nil {
		return nil, fmt.Errorf("failed to list collections in %s: %w", dbName, err)
	}

	s.log.Debug("Found %d collections in %s", len(collections), dbName)

	database := &types.Database{
		Name:          dbName,
		SizeBytes:     sizeOnDisk,
		DataSizeBytes: dataSize,
		Collections:   make([]types.Collection, 0, len(collections)),
	}

	// Scan collections concurrently
	var wg sync.WaitGroup
	var mu sync.Mutex
	semaphore := make(chan struct{}, s.options.Concurrency)

	for _, collName := range collections {
		// Skip system collections
		if len(collName) > 0 && collName[0] == '_' {
			continue
		}

		wg.Add(1)
		go func(collName string) {
			defer wg.Done()
			semaphore <- struct{}{}
			defer func() { <-semaphore }()

			collSchema, err := s.ScanCollection(ctx, dbName, collName)
			if err != nil {
				s.log.Error("Error scanning collection %s.%s: %v", dbName, collName, err)
				return
			}

			mu.Lock()
			database.Collections = append(database.Collections, *collSchema)
			mu.Unlock()
		}(collName)
	}

	wg.Wait()

	return database, nil
}

// ScanCollection scans a specific collection
func (s *Scanner) ScanCollection(ctx context.Context, dbName, collName string) (*types.Collection, error) {
	s.log.Debug("Scanning collection: %s.%s", dbName, collName)

	coll := s.client.Database(dbName).Collection(collName)

	// Get collection stats
	docCount, err := coll.EstimatedDocumentCount(ctx)
	if err != nil {
		s.log.Warn("Could not get document count for %s.%s: %v", dbName, collName, err)
		docCount = 0
	}

	// Get indexes
	indexes, err := s.getIndexes(ctx, coll)
	if err != nil {
		s.log.Warn("Could not get indexes for %s.%s: %v", dbName, collName, err)
		indexes = []string{}
	}

	// Use physical collection size for the UI. Sampled document sizes omit
	// indexes, storage overhead, compression effects, and sampling variance.
	collectionSize, err := s.getCollectionSize(ctx, dbName, collName)
	if err != nil {
		s.log.Warn("Could not get physical size for %s.%s: %v", dbName, collName, err)
		collectionSize = 0
	}

	var analysis *types.CollectionAnalysis
	var avgDocSize int64
	if s.options.Exhaustive {
		var scannedCount int64
		analysis, avgDocSize, scannedCount, err = s.analyzeAllDocuments(ctx, coll, dbName, collName)
		if err != nil {
			return nil, fmt.Errorf("failed to exhaustively scan documents from %s.%s: %w", dbName, collName, err)
		}
		docCount = scannedCount
	} else {
		// Determine sample size based on document count
		sampleSize := s.calculateSampleSize(docCount)

		// Sample documents
		docs, sampleErr := s.sampleDocuments(ctx, coll, sampleSize)
		if sampleErr != nil {
			return nil, fmt.Errorf("failed to sample documents from %s.%s: %w", dbName, collName, sampleErr)
		}

		s.log.Debug("Sampled %d documents from %s.%s", len(docs), dbName, collName)
		analysis = analyzer.AnalyzeDocuments(docs)

		if len(docs) > 0 {
			totalSize := int64(0)
			for _, doc := range docs {
				data, _ := bson.Marshal(doc)
				totalSize += int64(len(data))
			}
			avgDocSize = totalSize / int64(len(docs))
		}
	}

	collection := &types.Collection{
		Name:                collName,
		DocumentCount:       docCount,
		AverageDocSizeBytes: avgDocSize,
		SizeBytes:           collectionSize,
		Indexes:             indexes,
		Fields:              analysis.Fields,
	}

	return collection, nil
}

func (s *Scanner) analyzeAllDocuments(ctx context.Context, coll *mongo.Collection, dbName, collName string) (*types.CollectionAnalysis, int64, int64, error) {
	findOpts := options.Find().SetBatchSize(1000)
	cursor, err := coll.Find(ctx, bson.M{}, findOpts)
	if err != nil {
		return nil, 0, 0, err
	}
	defer cursor.Close(ctx)

	documentAnalyzer := analyzer.NewDocumentAnalyzer()
	var totalSize int64
	var documentCount int64
	for cursor.Next(ctx) {
		var doc bson.M
		if err := cursor.Decode(&doc); err != nil {
			return nil, 0, documentCount, err
		}

		documentAnalyzer.Add(doc)
		data, _ := bson.Marshal(doc)
		totalSize += int64(len(data))
		documentCount++
		if documentCount%10000 == 0 {
			s.log.Info("Exhaustively scanned %d documents from %s.%s", documentCount, dbName, collName)
		}
	}
	if err := cursor.Err(); err != nil {
		return nil, 0, documentCount, err
	}

	avgDocSize := int64(0)
	if documentCount > 0 {
		avgDocSize = totalSize / documentCount
	}
	s.log.Info("Exhaustive scan completed for %s.%s: %d documents", dbName, collName, documentCount)
	return documentAnalyzer.Result(), avgDocSize, documentCount, nil
}

func (s *Scanner) getCollectionSize(ctx context.Context, dbName, collName string) (int64, error) {
	var stats bson.M
	err := s.client.Database(dbName).RunCommand(ctx, bson.D{
		{Key: "collStats", Value: collName},
	}).Decode(&stats)
	if err != nil {
		return 0, err
	}

	if totalSize, ok := bsonInt64(stats["totalSize"]); ok {
		return totalSize, nil
	}

	// totalSize is storageSize + totalIndexSize. Keep a fallback for server
	// versions or collection types that do not return totalSize directly.
	storageSize, storageOK := bsonInt64(stats["storageSize"])
	indexSize, indexOK := bsonInt64(stats["totalIndexSize"])
	if storageOK || indexOK {
		return storageSize + indexSize, nil
	}

	return 0, fmt.Errorf("collStats did not return totalSize")
}

func bsonInt64(value interface{}) (int64, bool) {
	switch value := value.(type) {
	case int64:
		return value, true
	case int32:
		return int64(value), true
	case int:
		return int64(value), true
	case float64:
		return int64(value), true
	case float32:
		return int64(value), true
	default:
		return 0, false
	}
}

// calculateSampleSize determines how many documents to sample
func (s *Scanner) calculateSampleSize(docCount int64) int {
	maxDocs := s.options.MaxDocs
	if maxDocs <= 0 {
		maxDocs = 75000
	}

	if docCount < 50000 {
		// Scan all documents
		if int64(maxDocs) > docCount {
			return int(docCount)
		}
		return maxDocs
	} else if docCount < 200000 {
		// Sample 50,000
		if maxDocs < 50000 {
			return maxDocs
		}
		return 50000
	} else {
		// Sample 75,000
		if maxDocs < 75000 {
			return maxDocs
		}
		return 75000
	}
}

// sampleDocuments fetches sample documents from a collection
func (s *Scanner) sampleDocuments(ctx context.Context, coll *mongo.Collection, sampleSize int) ([]bson.M, error) {
	// Use aggregation with $sample for random sampling
	pipeline := mongo.Pipeline{
		{{Key: "$sample", Value: bson.D{{Key: "size", Value: sampleSize}}}},
	}

	cursor, err := coll.Aggregate(ctx, pipeline)
	if err != nil {
		// Fallback to find with limit if $sample fails
		s.log.Debug("$sample failed, falling back to find: %v", err)
		findOpts := options.Find().SetLimit(int64(sampleSize))
		cursor, err = coll.Find(ctx, bson.M{}, findOpts)
		if err != nil {
			return nil, err
		}
	}
	defer cursor.Close(ctx)

	var docs []bson.M
	if err := cursor.All(ctx, &docs); err != nil {
		return nil, err
	}

	return docs, nil
}

// getIndexes retrieves index names from a collection
func (s *Scanner) getIndexes(ctx context.Context, coll *mongo.Collection) ([]string, error) {
	cursor, err := coll.Indexes().List(ctx)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var indexes []string
	for cursor.Next(ctx) {
		var idx bson.M
		if err := cursor.Decode(&idx); err != nil {
			continue
		}
		if name, ok := idx["name"].(string); ok {
			indexes = append(indexes, name)
		}
	}

	return indexes, nil
}

// filterDatabases applies the database filter
func (s *Scanner) filterDatabases(databases []string) []string {
	if len(s.options.DBFilter) == 0 {
		return databases
	}

	var filtered []string
	for _, db := range databases {
		for _, pattern := range s.options.DBFilter {
			matched, err := regexp.MatchString(pattern, db)
			if err != nil {
				s.log.Warn("Invalid regex pattern %s: %v", pattern, err)
				continue
			}
			if matched {
				filtered = append(filtered, db)
				break
			}
		}
	}

	return filtered
}

// extractClusterName extracts cluster name from URI
func (s *Scanner) extractClusterName() string {
	// Try to extract cluster name from URI
	// Format: mongodb+srv://user:pass@cluster-name.xxxxx.mongodb.net
	re := regexp.MustCompile(`@([^/]+)`)
	matches := re.FindStringSubmatch(s.options.URI)
	if len(matches) > 1 {
		return matches[1]
	}
	return "unknown"
}
