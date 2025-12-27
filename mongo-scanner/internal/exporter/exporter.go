package exporter

import (
	"fmt"
	"io"

	"mongodb-scanner/internal/types"
)

// Format represents the export format type
type Format string

const (
	FormatJSON Format = "json"
	FormatYAML Format = "yaml"
	FormatCSV  Format = "csv"
)

// Exporter interface for all export formats
type Exporter interface {
	Export(result *types.ScanResult, w io.Writer) error
	ExportToFile(result *types.ScanResult, filepath string) error
}

// NewExporter creates an exporter based on format
func NewExporter(format Format) (Exporter, error) {
	switch format {
	case FormatJSON:
		return &JSONExporter{Pretty: true}, nil
	case FormatYAML:
		return &YAMLExporter{}, nil
	case FormatCSV:
		return &CSVExporter{}, nil
	default:
		return nil, fmt.Errorf("unsupported format: %s", format)
	}
}

// ValidFormats returns list of valid export formats
func ValidFormats() []string {
	return []string{string(FormatJSON), string(FormatYAML), string(FormatCSV)}
}
