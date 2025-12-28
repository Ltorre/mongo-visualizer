# Mongo Schema Scanner

A Golang CLI tool that scans MongoDB Atlas clusters and generates detailed schema reports.

## Features

- ✅ Connect to MongoDB Atlas with authentication
- ✅ Parallel scanning with goroutines
- ✅ Intelligent sampling based on document count
- ✅ BSON type detection
- ✅ Frequency calculation in percentages
- ✅ Nested field detection and path tracking
- ✅ Progress logging
- ✅ Error handling & recovery
- ✅ Multiple export formats (JSON, YAML, CSV)
- ✅ Configurable CLI flags
- ✅ Configurable timeout

## Installation

```bash
cd mongo-scanner
go mod tidy
go build -o mongo-scanner .
```

Prerequisites
- Go 1.24+


## Usage

```bash
# Basic usage
./mongo-scanner --uri "mongodb+srv://user:password@cluster.mongodb.net"

# With all options
./mongo-scanner \
  --uri "mongodb+srv://user:password@myapp.mongodb.net" \
  --output ./data/schema.json \
  --format json \
  --verbose \
  --timeout 600 \
  --max-docs 50000

# Filter specific databases
./mongo-scanner \
  --uri "mongodb+srv://..." \
  --db-filter "production,staging"
```

## CLI Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--uri` | (required) | MongoDB connection URI |
| `--output` | `./schema.json` | Output file path |
| `--format` | `json` | Output format: json, yaml, or csv |
| `--db-filter` | - | Comma-separated database name patterns (regex) |
| `--timeout` | 300 | Scan timeout in seconds |
| `--verbose` | false | Enable verbose logging |
| `--max-docs` | 75000 | Max documents to sample per collection |

## Sampling Strategy

- < 50,000 docs: Scan all documents
- 50,000 - 200,000 docs: Sample 50,000 documents
- > 200,000 docs: Sample 75,000 documents

## Output Format

### JSON Example

```json
{
  "cluster_name": "myapp.mongodb.net",
  "scan_timestamp": "2024-01-15T10:30:00Z",
  "databases": [
    {
      "name": "mydb",
      "size_bytes": 1234567,
      "collections": [
        {
          "name": "users",
          "document_count": 10000,
          "average_doc_size_bytes": 512,
          "indexes": ["_id", "email"],
          "fields": [
            {
              "path": "_id",
              "types": [{"type": "objectId", "frequency_percent": 100}],
              "inferred_type": "objectId",
              "presence_percent": 100
            },
            {
              "path": "email",
              "types": [
                {"type": "string", "frequency_percent": 98.5},
                {"type": "null", "frequency_percent": 1.5}
              ],
              "inferred_type": "string",
              "presence_percent": 99
            }
          ]
        }
      ]
    }
  ]
}
```
## Project Structure

```
mongo-scanner/
├── main.go              # Entry point
├── go.mod
├── cmd/
│   └── root.go          # Cobra CLI setup
└── internal/
  ├── scanner/
  │   ├── scanner.go   # Main scanning logic
  │   └── types.go     # Struct definitions
  ├── analyzer/
  │   ├── analyzer.go  # Schema inference
  │   └── types.go
  ├── exporter/
  │   ├── exporter.go  # Exporter interface
  │   ├── json.go      # JSON exporter
  │   ├── yaml.go      # YAML exporter
  │   └── csv.go       # CSV exporter
  └── logger/
    └── logger.go    # Logging utilities
```
## License

MIT

Notes
-----
- For large clusters consider running scans from a machine with a stable
  network and sufficient resources; sampling defaults are conservative.
- If you need custom exporters or integrations, add them under
  `internal/exporter` and register via the CLI flags.
