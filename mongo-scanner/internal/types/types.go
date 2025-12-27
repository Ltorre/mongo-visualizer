package types

import (
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

// ScanResult represents the complete scan output
type ScanResult struct {
	ClusterName   string     `json:"cluster_name" yaml:"cluster_name"`
	ScanTimestamp string     `json:"scan_timestamp" yaml:"scan_timestamp"`
	Databases     []Database `json:"databases" yaml:"databases"`
}

// Database represents a MongoDB database schema
type Database struct {
	Name        string       `json:"name" yaml:"name"`
	SizeBytes   int64        `json:"size_bytes" yaml:"size_bytes"`
	Collections []Collection `json:"collections" yaml:"collections"`
}

// Collection represents a MongoDB collection schema
type Collection struct {
	Name                string   `json:"name" yaml:"name"`
	DocumentCount       int64    `json:"document_count" yaml:"document_count"`
	AverageDocSizeBytes int64    `json:"average_doc_size_bytes" yaml:"average_doc_size_bytes"`
	Indexes             []string `json:"indexes" yaml:"indexes"`
	Fields              []Field  `json:"fields" yaml:"fields"`
}

// Field represents a document field with type information
type Field struct {
	Path            string          `json:"path" yaml:"path"`
	Types           []TypeFrequency `json:"types" yaml:"types"`
	InferredType    string          `json:"inferred_type" yaml:"inferred_type"`
	PresencePercent float64         `json:"presence_percent" yaml:"presence_percent"`
	NestedFields    []Field         `json:"nested_fields,omitempty" yaml:"nested_fields,omitempty"`
}

// TypeFrequency represents a BSON type and its frequency
type TypeFrequency struct {
	Type             string  `json:"type" yaml:"type"`
	FrequencyPercent float64 `json:"frequency_percent" yaml:"frequency_percent"`
}

// ScanOptions contains configuration for the scanner
type ScanOptions struct {
	URI         string
	Timeout     time.Duration
	MaxDocs     int
	DBFilter    []string
	Verbose     bool
	Concurrency int
}

// DefaultScanOptions returns default scanning options
func DefaultScanOptions() ScanOptions {
	return ScanOptions{
		Timeout:     5 * time.Minute,
		MaxDocs:     75000,
		Concurrency: 5,
		Verbose:     false,
	}
}

// CollectionAnalysis represents the analyzed schema of a collection
type CollectionAnalysis struct {
	Fields           []Field
	SchemaConfidence float64
	RareFields       []string
}

// GetBSONTypeName returns the string name of a BSON type
func GetBSONTypeName(val interface{}) string {
	if val == nil {
		return "null"
	}

	switch val.(type) {
	case string:
		return "string"
	case int, int32:
		return "int32"
	case int64:
		return "int64"
	case float64:
		return "double"
	case bool:
		return "boolean"
	case primitive.ObjectID:
		return "objectId"
	case primitive.DateTime, time.Time:
		return "date"
	case primitive.A, []interface{}:
		return "array"
	case bson.M, bson.D, map[string]interface{}:
		return "object"
	case primitive.Binary:
		return "binData"
	case primitive.Regex:
		return "regex"
	case primitive.Decimal128:
		return "decimal"
	case primitive.Timestamp:
		return "timestamp"
	default:
		return fmt.Sprintf("unknown(%T)", val)
	}
}
