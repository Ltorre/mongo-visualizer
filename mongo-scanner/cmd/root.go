package cmd

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"mongo-scanner/internal/exporter"
	"mongo-scanner/internal/logger"
	"mongo-scanner/internal/scanner"
	"mongo-scanner/internal/types"
)

var (
	// Flags
	uri      string
	output   string
	format   string
	dbFilter string
	timeout  int
	verbose  bool
	maxDocs  int
)

// rootCmd represents the base command
var rootCmd = &cobra.Command{
	Use:   "mongo-scanner",
	Short: "Scan MongoDB Atlas cluster and generate schema report",
	Long: `MongoDB Schema Scanner analyzes your MongoDB Atlas cluster
and generates a detailed report of the database structure including:
- All databases and collections
- Field types with frequency distribution
- Schema inference with confidence levels
- Nested field detection`,
	RunE: runScan,
}

// Execute adds all child commands to the root command and sets flags appropriately.
func Execute() {
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

func init() {
	rootCmd.Flags().StringVar(&uri, "uri", "", "MongoDB connection URI (required)")
	rootCmd.Flags().StringVar(&output, "output", "./schema.json", "Output file path")
	rootCmd.Flags().StringVar(&format, "format", "json", "Output format: json, yaml, or csv")
	rootCmd.Flags().StringVar(&dbFilter, "db-filter", "", "Comma-separated database name patterns (regex supported)")
	rootCmd.Flags().IntVar(&timeout, "timeout", 10000, "Scan timeout in seconds")
	rootCmd.Flags().BoolVar(&verbose, "verbose", false, "Enable verbose logging")
	rootCmd.Flags().IntVar(&maxDocs, "max-docs", 75000, "Maximum documents to sample per collection")

	rootCmd.MarkFlagRequired("uri")
}

func runScan(cmd *cobra.Command, args []string) error {
	log := logger.NewLogger(verbose)

	// Parse format
	exportFormat := exporter.Format(strings.ToLower(format))
	exp, err := exporter.NewExporter(exportFormat)
	if err != nil {
		return fmt.Errorf("invalid format: %s. Valid formats: %v", format, exporter.ValidFormats())
	}

	// Parse database filter
	var dbFilters []string
	if dbFilter != "" {
		dbFilters = strings.Split(dbFilter, ",")
		for i := range dbFilters {
			dbFilters[i] = strings.TrimSpace(dbFilters[i])
		}
	}

	// Create scanner options
	opts := types.ScanOptions{
		URI:         uri,
		Timeout:     time.Duration(timeout) * time.Second,
		MaxDocs:     maxDocs,
		DBFilter:    dbFilters,
		Verbose:     verbose,
		Concurrency: 5,
	}

	log.Info("Starting MongoDB schema scan...")
	log.Debug("URI: %s", maskURI(uri))
	log.Debug("Output: %s", output)
	log.Debug("Format: %s", format)
	log.Debug("Timeout: %d seconds", timeout)
	log.Debug("Max docs per collection: %d", maxDocs)

	// Create scanner
	s, err := scanner.NewScanner(opts, log)
	if err != nil {
		return fmt.Errorf("failed to create scanner: %w", err)
	}

	// Create context with timeout
	ctx, cancel := context.WithTimeout(context.Background(), opts.Timeout)
	defer cancel()
	defer s.Close(ctx)

	// Run scan
	startTime := time.Now()
	result, err := s.ScanAll(ctx)
	if err != nil {
		return fmt.Errorf("scan failed: %w", err)
	}

	elapsed := time.Since(startTime)
	log.Info("Scan completed in %s", elapsed.Round(time.Millisecond))

	// Export results
	if err := exp.ExportToFile(result, output); err != nil {
		return fmt.Errorf("failed to export results: %w", err)
	}

	log.Info("Schema exported to: %s", output)

	// Print summary
	printSummary(result, log)

	return nil
}

// maskURI hides the password in the URI for logging
func maskURI(uri string) string {
	// Simple masking - replace password portion
	if idx := strings.Index(uri, "@"); idx > 0 {
		prefix := uri[:strings.Index(uri, "://")+3]
		suffix := uri[idx:]
		return prefix + "****:****" + suffix
	}
	return uri
}

// printSummary outputs a summary of the scan
func printSummary(result *types.ScanResult, log *logger.Logger) {
	totalCollections := 0
	totalFields := 0

	for _, db := range result.Databases {
		totalCollections += len(db.Collections)
		for _, coll := range db.Collections {
			totalFields += countFields(coll.Fields)
		}
	}

	log.Info("=== Scan Summary ===")
	log.Info("Cluster: %s", result.ClusterName)
	log.Info("Databases: %d", len(result.Databases))
	log.Info("Collections: %d", totalCollections)
	log.Info("Total Fields: %d", totalFields)
}

// countFields recursively counts fields including nested
func countFields(fields []types.Field) int {
	count := len(fields)
	for _, f := range fields {
		if len(f.NestedFields) > 0 {
			count += countFields(f.NestedFields)
		}
	}
	return count
}
