package exporter

import (
	"encoding/csv"
	"fmt"
	"io"
	"os"
	"strings"

	"mongo-scanner/internal/types"
)

// CSVExporter exports scan results to CSV format
type CSVExporter struct{}

// Export writes the scan result as CSV
func (e *CSVExporter) Export(result *types.ScanResult, w io.Writer) error {
	writer := csv.NewWriter(w)
	defer writer.Flush()

	// Write header
	header := []string{
		"Database",
		"Collection",
		"Document Count",
		"Avg Doc Size (bytes)",
		"Field Path",
		"Inferred Type",
		"Presence %",
		"Type Distribution",
	}
	if err := writer.Write(header); err != nil {
		return err
	}

	// Write data
	for _, db := range result.Databases {
		for _, coll := range db.Collections {
			e.writeFields(writer, db.Name, coll.Name, coll.DocumentCount, coll.AverageDocSizeBytes, coll.Fields, "")
		}
	}

	return nil
}

// writeFields recursively writes fields to CSV
func (e *CSVExporter) writeFields(writer *csv.Writer, dbName, collName string, docCount, avgSize int64, fields []types.Field, prefix string) {
	for _, field := range fields {
		path := field.Path
		if prefix != "" {
			path = prefix + "." + field.Path
		}

		// Build type distribution string
		var typeStrs []string
		for _, t := range field.Types {
			typeStrs = append(typeStrs, fmt.Sprintf("%s:%.1f%%", t.Type, t.FrequencyPercent))
		}
		typeDist := strings.Join(typeStrs, ", ")

		row := []string{
			dbName,
			collName,
			fmt.Sprintf("%d", docCount),
			fmt.Sprintf("%d", avgSize),
			path,
			field.InferredType,
			fmt.Sprintf("%.1f", field.PresencePercent),
			typeDist,
		}
		writer.Write(row)

		// Write nested fields
		if len(field.NestedFields) > 0 {
			e.writeFields(writer, dbName, collName, docCount, avgSize, field.NestedFields, path)
		}
	}
}

// ExportToFile writes the scan result to a CSV file
func (e *CSVExporter) ExportToFile(result *types.ScanResult, filepath string) error {
	f, err := os.Create(filepath)
	if err != nil {
		return fmt.Errorf("failed to create file %s: %w", filepath, err)
	}
	defer f.Close()

	return e.Export(result, f)
}
