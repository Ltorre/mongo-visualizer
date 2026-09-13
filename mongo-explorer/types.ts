export interface FieldType {
  type: string;
  frequency_percent: number;
}

export interface Field {
  path: string;
  types: FieldType[];
  inferred_type: string;
  presence_percent: number;
  nested_fields?: Field[];
}

export interface Collection {
  name: string;
  document_count: number;
  average_doc_size_bytes: number;
  /** Physical collection size from collStats, including indexes. */
  size_bytes?: number;
  indexes: string[];
  fields: Field[];
}

export interface Database {
  name: string;
  size_bytes: number;
  data_size_bytes?: number;
  collections: Collection[];
}

export interface ClusterScan {
  schema_version?: number;
  cluster_name: string;
  scan_timestamp: string;
  databases: Database[];
}

export enum ViewLevel {
  CLUSTER = 'System Context',
  DATABASE = 'Container',
  COLLECTION = 'Component',
  FIELD = 'Field Analysis',
}

export interface BreadcrumbItem {
  label: string;
  level: ViewLevel;
  id?: string; // e.g., db name or collection name
}
