package exporter

import (
	"encoding/json"
	"fmt"
	"io"
	"os"

	"mongodb-scanner/internal/types"
)

// JSONExporter exports scan results to JSON format
type JSONExporter struct {
	Pretty bool
}

// Export writes the scan result as JSON
func (e *JSONExporter) Export(result *types.ScanResult, w io.Writer) error {
	encoder := json.NewEncoder(w)
	if e.Pretty {
		encoder.SetIndent("", "  ")
	}
	return encoder.Encode(result)
}

// ExportToFile writes the scan result to a JSON file
func (e *JSONExporter) ExportToFile(result *types.ScanResult, filepath string) error {
	f, err := os.Create(filepath)
	if err != nil {
		return fmt.Errorf("failed to create file %s: %w", filepath, err)
	}
	defer f.Close()

	return e.Export(result, f)
}
