package exporter

import (
	"fmt"
	"io"
	"os"

	"gopkg.in/yaml.v3"

	"mongodb-scanner/internal/types"
)

// YAMLExporter exports scan results to YAML format
type YAMLExporter struct{}

// Export writes the scan result as YAML
func (e *YAMLExporter) Export(result *types.ScanResult, w io.Writer) error {
	encoder := yaml.NewEncoder(w)
	encoder.SetIndent(2)
	return encoder.Encode(result)
}

// ExportToFile writes the scan result to a YAML file
func (e *YAMLExporter) ExportToFile(result *types.ScanResult, filepath string) error {
	f, err := os.Create(filepath)
	if err != nil {
		return fmt.Errorf("failed to create file %s: %w", filepath, err)
	}
	defer f.Close()

	return e.Export(result, f)
}
