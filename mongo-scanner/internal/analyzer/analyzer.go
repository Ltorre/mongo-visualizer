package analyzer

import (
	"sort"
	"strings"

	"go.mongodb.org/mongo-driver/bson"

	"mongodb-scanner/internal/types"
)

// AnalyzeDocuments analyzes a slice of documents and returns field statistics
func AnalyzeDocuments(docs []bson.M) *types.CollectionAnalysis {
	if len(docs) == 0 {
		return &types.CollectionAnalysis{
			Fields:           []types.Field{},
			SchemaConfidence: 0,
		}
	}

	// Track field occurrences and types
	fieldStats := make(map[string]*fieldStat)
	totalDocs := len(docs)

	for _, doc := range docs {
		extractFields(doc, "", fieldStats)
	}

	// Convert to Field slice
	fields := make([]types.Field, 0, len(fieldStats))
	var rareFields []string

	for path, stat := range fieldStats {
		// Skip nested paths (they'll be handled as nested_fields)
		if strings.Contains(path, ".") {
			continue
		}

		field := buildField(path, stat, fieldStats, totalDocs)
		fields = append(fields, field)

		if field.PresencePercent < 5.0 {
			rareFields = append(rareFields, path)
		}
	}

	// Sort fields alphabetically, but keep _id first
	sort.Slice(fields, func(i, j int) bool {
		if fields[i].Path == "_id" {
			return true
		}
		if fields[j].Path == "_id" {
			return false
		}
		return fields[i].Path < fields[j].Path
	})

	// Calculate schema confidence
	confidence := calculateSchemaConfidence(fields)

	return &types.CollectionAnalysis{
		Fields:           fields,
		SchemaConfidence: confidence,
		RareFields:       rareFields,
	}
}

// fieldStat tracks statistics for a single field path
type fieldStat struct {
	occurrences int
	types       map[string]int
	isObject    bool
	isArray     bool
}

// extractFields recursively extracts all field paths from a document
func extractFields(doc bson.M, prefix string, stats map[string]*fieldStat) {
	for key, value := range doc {
		path := key
		if prefix != "" {
			path = prefix + "." + key
		}

		// Initialize or update field stats
		if _, exists := stats[path]; !exists {
			stats[path] = &fieldStat{
				types: make(map[string]int),
			}
		}

		stat := stats[path]
		stat.occurrences++

		// Detect type
		typeName := types.GetBSONTypeName(value)
		stat.types[typeName]++

		// Handle nested objects
		if typeName == "object" {
			stat.isObject = true
			if nestedDoc, ok := value.(bson.M); ok {
				extractFields(nestedDoc, path, stats)
			} else if nestedDoc, ok := value.(map[string]interface{}); ok {
				extractFields(bson.M(nestedDoc), path, stats)
			}
		}

		// Handle arrays
		if typeName == "array" {
			stat.isArray = true
			if arr, ok := value.([]interface{}); ok {
				analyzeArray(arr, path, stats)
			}
		}
	}
}

// analyzeArray analyzes array contents
func analyzeArray(arr []interface{}, path string, stats map[string]*fieldStat) {
	arrayPath := path + "[]"

	if _, exists := stats[arrayPath]; !exists {
		stats[arrayPath] = &fieldStat{
			types: make(map[string]int),
		}
	}

	for _, item := range arr {
		typeName := types.GetBSONTypeName(item)
		stats[arrayPath].types[typeName]++
		stats[arrayPath].occurrences++

		// If array contains objects, analyze their structure
		if typeName == "object" {
			if nestedDoc, ok := item.(bson.M); ok {
				extractFields(nestedDoc, arrayPath, stats)
			} else if nestedDoc, ok := item.(map[string]interface{}); ok {
				extractFields(bson.M(nestedDoc), arrayPath, stats)
			}
		}
	}
}

// buildField creates a Field struct from collected statistics
func buildField(path string, stat *fieldStat, allStats map[string]*fieldStat, totalDocs int) types.Field {
	// Calculate type frequencies
	typeFreqs := make([]types.TypeFrequency, 0, len(stat.types))
	totalOccurrences := 0
	for _, count := range stat.types {
		totalOccurrences += count
	}

	for typeName, count := range stat.types {
		freq := float64(count) / float64(totalOccurrences) * 100
		typeFreqs = append(typeFreqs, types.TypeFrequency{
			Type:             typeName,
			FrequencyPercent: round2(freq),
		})
	}

	// Sort types by frequency (descending)
	sort.Slice(typeFreqs, func(i, j int) bool {
		return typeFreqs[i].FrequencyPercent > typeFreqs[j].FrequencyPercent
	})

	// Infer type
	inferredType := inferType(typeFreqs)

	// Calculate presence percentage
	presencePercent := float64(stat.occurrences) / float64(totalDocs) * 100

	field := types.Field{
		Path:            path,
		Types:           typeFreqs,
		InferredType:    inferredType,
		PresencePercent: round2(presencePercent),
	}

	// Add nested fields for objects
	if stat.isObject {
		field.NestedFields = getNestedFields(path, allStats, totalDocs)
	}

	return field
}

// getNestedFields collects all nested fields under a given path
func getNestedFields(parentPath string, allStats map[string]*fieldStat, totalDocs int) []types.Field {
	var nested []types.Field
	prefix := parentPath + "."

	for path, stat := range allStats {
		if strings.HasPrefix(path, prefix) {
			// Check if this is a direct child (not nested deeper)
			remaining := strings.TrimPrefix(path, prefix)
			if !strings.Contains(remaining, ".") {
				field := buildField(remaining, stat, allStats, totalDocs)
				field.Path = remaining // Use relative path
				nested = append(nested, field)
			}
		}
	}

	// Sort nested fields
	sort.Slice(nested, func(i, j int) bool {
		return nested[i].Path < nested[j].Path
	})

	return nested
}

// inferType determines the most likely type based on frequencies
func inferType(typeFreqs []types.TypeFrequency) string {
	if len(typeFreqs) == 0 {
		return "unknown"
	}

	// If the top type is > 75%, use it
	if typeFreqs[0].FrequencyPercent > 75 {
		return typeFreqs[0].Type
	}

	// Otherwise mark as mixed
	return "mixed"
}

// calculateSchemaConfidence calculates overall schema consistency
func calculateSchemaConfidence(fields []types.Field) float64 {
	if len(fields) == 0 {
		return 0
	}

	totalConfidence := 0.0
	for _, field := range fields {
		if len(field.Types) > 0 {
			// Confidence is based on how dominant the main type is
			topTypeFreq := field.Types[0].FrequencyPercent
			fieldConfidence := topTypeFreq / 100.0

			// Also factor in presence
			presenceWeight := field.PresencePercent / 100.0

			totalConfidence += fieldConfidence * presenceWeight
		}
	}

	return round2(totalConfidence / float64(len(fields)) * 100)
}

// round2 rounds a float to 2 decimal places
func round2(f float64) float64 {
	return float64(int(f*100+0.5)) / 100
}

// DetectFieldTypes analyzes an array of values and returns type frequencies
func DetectFieldTypes(values []interface{}) []types.TypeFrequency {
	if len(values) == 0 {
		return nil
	}

	typeCounts := make(map[string]int)
	for _, val := range values {
		typeName := types.GetBSONTypeName(val)
		typeCounts[typeName]++
	}

	typeFreqs := make([]types.TypeFrequency, 0, len(typeCounts))
	total := len(values)

	for typeName, count := range typeCounts {
		typeFreqs = append(typeFreqs, types.TypeFrequency{
			Type:             typeName,
			FrequencyPercent: round2(float64(count) / float64(total) * 100),
		})
	}

	sort.Slice(typeFreqs, func(i, j int) bool {
		return typeFreqs[i].FrequencyPercent > typeFreqs[j].FrequencyPercent
	})

	return typeFreqs
}

// InferType infers the primary type from type frequencies
func InferType(frequencies []types.TypeFrequency) string {
	return inferType(frequencies)
}
