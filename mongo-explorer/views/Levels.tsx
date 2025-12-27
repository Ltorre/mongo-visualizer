import React, { useState } from 'react';
import { Database, HardDrive, FileText, Database as DbIcon, Edit2, Search, ArrowRight, Layers, Table, Info, Hash, PieChart, Activity, Link, ArrowDownAZ, ArrowDownWideNarrow, Maximize2, Minimize2, FileCode, Copy, Check } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { ClusterScan, Database as IDatabase, Collection, ViewLevel, Field } from '../types';
import { formatBytes, formatNumber, getColorForType } from '../utils';
import { SizeChart } from '../components/Charts';
import { SchemaNode } from '../components/Schema';

// --- Shared Components ---

const StatCard = ({ label, value, icon: Icon, subtext }: { label: string, value: string, icon: any, subtext?: string }) => (
  <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-start justify-between">
    <div>
      <p className="text-sm font-medium text-slate-500 mb-1">{label}</p>
      <h3 className="text-2xl font-bold text-slate-900">{value}</h3>
      {subtext && <p className="text-xs text-slate-400 mt-1">{subtext}</p>}
    </div>
    <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600">
      <Icon size={20} />
    </div>
  </div>
);

const SearchBar = ({ value, onChange, placeholder }: { value: string, onChange: (v: string) => void, placeholder: string }) => (
  <div className="relative">
    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
    <input
      type="text"
      placeholder={placeholder}
      className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  </div>
);

const SortToggle = ({ value, onChange }: { value: 'size' | 'alpha', onChange: (v: 'size' | 'alpha') => void }) => (
  <div className="flex bg-slate-100 p-1 rounded-lg">
    <button 
      className={`p-1.5 rounded-md transition-all ${value === 'alpha' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
      onClick={() => onChange('alpha')}
      title="Sort Alphabetically"
    >
      <ArrowDownAZ size={18} />
    </button>
    <button 
      className={`p-1.5 rounded-md transition-all ${value === 'size' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
      onClick={() => onChange('size')}
      title="Sort by Size"
    >
      <ArrowDownWideNarrow size={18} />
    </button>
  </div>
);

// --- Helper Functions for Go Struct Generation ---

const toPascalCase = (str: string) => {
  return str
    .replace(/(?:^\w|[A-Z]|\b\w)/g, (word, index) => word.toUpperCase())
    .replace(/[\s_-]+/g, '');
};

const generateGoStruct = (collectionName: string, fields: Field[]): string => {
  const structName = toPascalCase(collectionName);
  
  const processFields = (fields: Field[], indent: string): string => {
    if (!fields || fields.length === 0) return '';
    
    return fields.map(field => {
       const key = field.path.split('.').pop() || '';
       // Clean key for Go field name, handle special characters if any
       const cleanKey = key.replace(/[^a-zA-Z0-9_]/g, '');
       let goName = key === '_id' ? 'ID' : toPascalCase(cleanKey);
       // Ensure it starts with a letter
       if (/^[0-9]/.test(goName)) goName = 'N' + goName;

       let typeStr = 'interface{}';
       const t = field.inferred_type.toLowerCase();

       if (t === 'objectid') typeStr = 'primitive.ObjectID';
       else if (t === 'string') typeStr = 'string';
       else if (t === 'boolean') typeStr = 'bool';
       else if (t === 'date') typeStr = 'time.Time';
       else if (['int32', 'int64', 'number'].includes(t)) typeStr = 'int64';
       else if (t === 'double') typeStr = 'float64';
       else if (t === 'array') typeStr = '[]interface{}'; 
       else if (t === 'object') {
           if (field.nested_fields && field.nested_fields.length > 0) {
               typeStr = `struct {\n${processFields(field.nested_fields, indent + '    ')}${indent}}`;
           } else {
               typeStr = 'map[string]interface{}';
           }
       }

       return `${indent}${goName.padEnd(20)} ${typeStr.padEnd(20)} \`bson:"${key}"\``;
    }).join('\n');
  };

  const imports = [
      '"time"',
      '"go.mongodb.org/mongo-driver/bson/primitive"'
  ].join('\n\t');

  return `package models

import (
\t${imports}
)

type ${structName} struct {
${processFields(fields, '    ')}
}`;
};

// --- Helper Functions for Search ---

const countFieldMatches = (fields: Field[], term: string): number => {
  let count = 0;
  for (const f of fields) {
    if (f.path.toLowerCase().includes(term)) count++;
    if (f.nested_fields && f.nested_fields.length > 0) {
      count += countFieldMatches(f.nested_fields, term);
    }
  }
  return count;
};

const getDatabaseMatchStats = (db: IDatabase, term: string) => {
    if (!term) return { collectionMatches: 0, fieldMatches: 0 };
    const lowerTerm = term.toLowerCase();
    
    let collectionMatches = 0;
    let fieldMatches = 0;

    db.collections.forEach(col => {
        if (col.name.toLowerCase().includes(lowerTerm)) collectionMatches++;
        fieldMatches += countFieldMatches(col.fields, lowerTerm);
    });

    return { collectionMatches, fieldMatches };
};


// --- Level 1: System Context (Cluster) ---

interface ClusterViewProps {
  data: ClusterScan;
  onSelectDatabase: (db: IDatabase) => void;
  clusterName: string;
  onRenameCluster: (name: string) => void;
}

export const ClusterView: React.FC<ClusterViewProps> = ({ data, onSelectDatabase, clusterName, onRenameCluster }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [tempName, setTempName] = useState(clusterName);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'size' | 'alpha'>('size');

  const totalSize = data.databases.reduce((acc, db) => acc + db.size_bytes, 0);
  const totalCollections = data.databases.reduce((acc, db) => acc + db.collections.length, 0);
  
  const lowerSearch = search.toLowerCase();

  const filteredDBs = data.databases.filter(db => {
    if (!lowerSearch) return true;
    
    // 1. Check DB Name
    if (db.name.toLowerCase().includes(lowerSearch)) return true;
    
    // 2. Deep Check (Collections & Fields)
    const stats = getDatabaseMatchStats(db, lowerSearch);
    return stats.collectionMatches > 0 || stats.fieldMatches > 0;
  });

  // Sorting
  if (sortBy === 'size') {
    filteredDBs.sort((a, b) => b.size_bytes - a.size_bytes);
  } else {
    filteredDBs.sort((a, b) => a.name.localeCompare(b.name));
  }

  const chartData = filteredDBs.map(db => ({ name: db.name, size: db.size_bytes }));

  const handleRename = () => {
    if (tempName.trim()) {
      onRenameCluster(tempName);
      setIsEditing(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold tracking-wider text-indigo-600 uppercase bg-indigo-50 px-2 py-0.5 rounded">Level 1: System Context</span>
          </div>
          <div className="flex items-center gap-3">
            {isEditing ? (
              <div className="flex items-center gap-2">
                <input 
                  autoFocus
                  className="text-3xl font-bold text-slate-900 bg-white border border-slate-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={tempName}
                  onChange={e => setTempName(e.target.value)}
                  onBlur={handleRename}
                  onKeyDown={e => e.key === 'Enter' && handleRename()}
                />
              </div>
            ) : (
              <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
                {clusterName}
                <button onClick={() => setIsEditing(true)} className="text-slate-400 hover:text-indigo-600 transition-colors">
                  <Edit2 size={18} />
                </button>
              </h1>
            )}
          </div>
          <p className="text-slate-500 mt-1">Scan Date: {new Date(data.scan_timestamp).toLocaleString()}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard label="Total Databases" value={data.databases.length.toString()} icon={HardDrive} />
        <StatCard label="Total Collections" value={totalCollections.toString()} icon={Layers} />
        <StatCard label="Total Size" value={formatBytes(totalSize)} icon={Database} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-800">Databases</h2>
            <div className="flex items-center gap-3">
              <div className="w-64">
                <SearchBar value={search} onChange={setSearch} placeholder="Search databases, collections, fields..." />
              </div>
              <SortToggle value={sortBy} onChange={setSortBy} />
            </div>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {filteredDBs.map((db) => {
               const { collectionMatches, fieldMatches } = getDatabaseMatchStats(db, lowerSearch);
               return (
                <div 
                  key={db.name}
                  onClick={() => onSelectDatabase(db)}
                  className="group bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-indigo-300 transition-all cursor-pointer relative overflow-hidden"
                >
                  <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                    <ArrowRight className="text-indigo-500" size={20} />
                  </div>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="p-2 bg-slate-100 rounded-lg group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors">
                      <DbIcon size={20} />
                    </div>
                    <h3 className="font-semibold text-slate-900 truncate" title={db.name}>{db.name}</h3>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-slate-500">
                    <span>{db.collections.length} Collections</span>
                    <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
                    <span>{formatBytes(db.size_bytes)}</span>
                  </div>

                  {search && (collectionMatches > 0 || fieldMatches > 0) && (
                    <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap gap-2 animate-in fade-in">
                        {collectionMatches > 0 && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full">
                                {collectionMatches} Coll. Matches
                            </span>
                        )}
                        {fieldMatches > 0 && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-purple-700 bg-purple-50 border border-purple-100 px-2 py-0.5 rounded-full">
                                {fieldMatches} Field Matches
                            </span>
                        )}
                    </div>
                  )}
                </div>
              );
            })}
            {filteredDBs.length === 0 && (
              <div className="col-span-full py-12 text-center text-slate-400 italic">
                No databases found matching your search.
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-1">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm sticky top-6">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">Size Distribution</h2>
            <SizeChart data={chartData} />
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Level 2: Container (Database) ---

interface DatabaseViewProps {
  database: IDatabase;
  onSelectCollection: (col: Collection) => void;
}

export const DatabaseView: React.FC<DatabaseViewProps> = ({ database, onSelectCollection }) => {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'size' | 'alpha'>('size');

  const lowerSearch = search.toLowerCase();

  const filteredCollections = database.collections.filter(c => {
    if (!lowerSearch) return true;
    if (c.name.toLowerCase().includes(lowerSearch)) return true;
    return countFieldMatches(c.fields, lowerSearch) > 0;
  });

  // Sorting
  if (sortBy === 'size') {
    filteredCollections.sort((a, b) => (b.document_count * b.average_doc_size_bytes) - (a.document_count * a.average_doc_size_bytes));
  } else {
    filteredCollections.sort((a, b) => a.name.localeCompare(b.name));
  }

  const chartData = filteredCollections.map(c => ({ 
    name: c.name, 
    size: c.document_count * c.average_doc_size_bytes 
  }));

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold tracking-wider text-emerald-600 uppercase bg-emerald-50 px-2 py-0.5 rounded">Level 2: Container</span>
        </div>
        <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
          <DbIcon className="text-slate-400" />
          {database.name}
        </h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard label="Collections" value={database.collections.length.toString()} icon={Layers} />
        <StatCard label="Total Documents" value={formatNumber(database.collections.reduce((acc, c) => acc + c.document_count, 0))} icon={FileText} />
        <StatCard label="Total Size" value={formatBytes(database.size_bytes)} icon={Database} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-800">Collections</h2>
            <div className="flex items-center gap-3">
              <div className="w-64">
                <SearchBar value={search} onChange={setSearch} placeholder="Search collections, fields..." />
              </div>
              <SortToggle value={sortBy} onChange={setSortBy} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {filteredCollections.map((col) => {
              const fieldMatches = search ? countFieldMatches(col.fields, lowerSearch) : 0;
              
              return (
                <div 
                  key={col.name}
                  onClick={() => onSelectCollection(col)}
                  className="group bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-indigo-300 transition-all cursor-pointer flex items-center justify-between"
                >
                  <div className="flex items-center gap-4 overflow-hidden">
                    <div className="p-2 bg-slate-50 rounded-lg group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors self-start">
                      <Table size={18} />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-slate-900 truncate pr-4">{col.name}</h3>
                      <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                        <span>{formatNumber(col.document_count)} Docs</span>
                        <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
                        <span>Avg: {formatBytes(col.average_doc_size_bytes)}</span>
                      </div>
                      {fieldMatches > 0 && (
                          <div className="mt-2 animate-in fade-in">
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-purple-700 bg-purple-50 border border-purple-100 px-2 py-0.5 rounded-full">
                                  {fieldMatches} Field Matches
                              </span>
                          </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 pl-4">
                    <span className="text-sm font-medium text-slate-600 bg-slate-50 px-2 py-1 rounded whitespace-nowrap">
                      {formatBytes(col.document_count * col.average_doc_size_bytes)}
                    </span>
                    <ArrowRight className="text-slate-300 group-hover:text-indigo-500 transition-colors" size={18} />
                  </div>
                </div>
              );
            })}
             {filteredCollections.length === 0 && (
              <div className="py-12 text-center text-slate-400 italic">
                No collections found matching your search.
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-1">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm sticky top-6">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">Largest Collections</h2>
            <SizeChart data={chartData} />
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Level 3: Component (Collection/Code) ---

interface CollectionViewProps {
  collection: Collection;
  onSelectField: (field: Field) => void;
}

export const CollectionView: React.FC<CollectionViewProps> = ({ collection, onSelectField }) => {
  const [activeTab, setActiveTab] = useState<'schema' | 'indexes' | 'gostruct'>('schema');
  const [expandTrigger, setExpandTrigger] = useState(0);
  const [collapseTrigger, setCollapseTrigger] = useState(0);
  const [copied, setCopied] = useState(false);

  const totalSize = collection.document_count * collection.average_doc_size_bytes;

  const handleCopyCode = () => {
    const code = generateGoStruct(collection.name, collection.fields);
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold tracking-wider text-blue-600 uppercase bg-blue-50 px-2 py-0.5 rounded">Level 3: Component Code</span>
        </div>
        <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
          <Table className="text-slate-400" />
          {collection.name}
        </h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard label="Documents" value={formatNumber(collection.document_count)} icon={FileText} />
        <StatCard label="Avg Size" value={formatBytes(collection.average_doc_size_bytes)} icon={Info} />
        <StatCard label="Total Size" value={formatBytes(totalSize)} icon={Database} />
        <StatCard label="Indexes" value={collection.indexes.length.toString()} icon={Layers} />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden min-h-[500px]">
        <div className="border-b border-slate-200 px-6 py-4 flex gap-6 justify-between items-center bg-white">
            <div className="flex gap-6 overflow-x-auto no-scrollbar">
                <button 
                    onClick={() => setActiveTab('schema')}
                    className={`text-sm font-semibold pb-4 -mb-4 border-b-2 transition-colors whitespace-nowrap ${activeTab === 'schema' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                >
                    Schema & Fields
                </button>
                <button 
                    onClick={() => setActiveTab('indexes')}
                    className={`text-sm font-semibold pb-4 -mb-4 border-b-2 transition-colors whitespace-nowrap ${activeTab === 'indexes' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                >
                    Indexes
                </button>
                <button 
                    onClick={() => setActiveTab('gostruct')}
                    className={`text-sm font-semibold pb-4 -mb-4 border-b-2 transition-colors whitespace-nowrap flex items-center gap-2 ${activeTab === 'gostruct' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                >
                    <FileCode size={14} /> Go Struct
                </button>
            </div>
            
            {activeTab === 'schema' && (
                <div className="flex gap-2">
                    <button 
                        onClick={() => setExpandTrigger(t => t + 1)}
                        className="text-xs font-medium text-slate-500 hover:text-indigo-600 bg-slate-50 hover:bg-indigo-50 px-2 py-1.5 rounded flex items-center gap-1 transition-colors"
                        title="Expand All Fields"
                    >
                        <Maximize2 size={12} /> Expand All
                    </button>
                    <button 
                        onClick={() => setCollapseTrigger(t => t + 1)}
                        className="text-xs font-medium text-slate-500 hover:text-indigo-600 bg-slate-50 hover:bg-indigo-50 px-2 py-1.5 rounded flex items-center gap-1 transition-colors"
                        title="Collapse All Fields"
                    >
                        <Minimize2 size={12} /> Collapse All
                    </button>
                </div>
            )}
             {activeTab === 'gostruct' && (
                <button 
                    onClick={handleCopyCode}
                    className={`text-xs font-medium px-3 py-1.5 rounded flex items-center gap-1.5 transition-all ${copied ? 'bg-emerald-100 text-emerald-700' : 'text-slate-500 hover:text-indigo-600 bg-slate-50 hover:bg-indigo-50'}`}
                    title="Copy Code"
                >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? 'Copied' : 'Copy Code'}
                </button>
            )}
        </div>

        <div className="p-0">
          {activeTab === 'schema' && (
            <div className="animate-in fade-in duration-300">
              <div className="bg-slate-50 px-6 py-2 border-b border-slate-200 flex text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <div className="flex-1">Field Name</div>
                <div className="w-32 text-right">Frequency</div>
              </div>
              {collection.fields.length > 0 ? (
                collection.fields.map((field, idx) => (
                  <SchemaNode 
                    key={idx} 
                    field={field} 
                    onSelectField={onSelectField} 
                    expandTrigger={expandTrigger}
                    collapseTrigger={collapseTrigger}
                  />
                ))
              ) : (
                <div className="p-12 text-center text-slate-400">
                  <Info className="mx-auto mb-2 opacity-50" size={32} />
                  No field information available for this collection.
                </div>
              )}
            </div>
          )}

          {activeTab === 'indexes' && (
            <div className="p-6 animate-in fade-in duration-300">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {collection.indexes.map((idx, i) => (
                  <div key={i} className="p-4 bg-slate-50 border border-slate-200 rounded-lg font-mono text-sm text-slate-700 flex items-center gap-2">
                    <Hash size={14} className="text-slate-400" />
                    {idx}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'gostruct' && (
            <div className="relative bg-slate-900 min-h-[500px] overflow-auto animate-in fade-in duration-300">
              <pre className="p-6 font-mono text-sm text-indigo-100 leading-relaxed">
                <code>{generateGoStruct(collection.name, collection.fields)}</code>
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// --- Level 4: Field Analysis ---

interface FieldViewProps {
  field: Field;
  collection: Collection;
}

export const FieldView: React.FC<FieldViewProps> = ({ field, collection }) => {
  // Simple heuristic to find related indexes: check if index string contains field name
  const relatedIndexes = collection.indexes.filter(idx => 
    idx.includes(field.path) || idx.includes(field.path.split('.').pop() || '')
  );

  const chartData = field.types.map(t => ({
    name: t.type,
    value: t.frequency_percent
  })).sort((a, b) => b.value - a.value);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-3 border border-slate-100 shadow-xl rounded-lg">
          <p className="font-semibold text-slate-800">{label}</p>
          <p className="text-indigo-600 font-medium">
            {Math.round(payload[0].value)}%
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold tracking-wider text-purple-600 uppercase bg-purple-50 px-2 py-0.5 rounded">Level 4: Field Analysis</span>
        </div>
        <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
          <PieChart className="text-slate-400" />
          <span className="font-mono text-2xl">{field.path}</span>
        </h1>
        <p className="text-slate-500 mt-2">
          Found in <span className="font-semibold text-slate-900">{Math.round(field.presence_percent)}%</span> of documents in <span className="font-medium text-slate-700">{collection.name}</span>.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Type Distribution Column */}
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-800 mb-6 flex items-center gap-2">
              <Activity size={20} className="text-slate-400" />
              Type Distribution
            </h2>
            
            <div className="h-64 w-full mb-6">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                  <XAxis dataKey="name" tick={{fontSize: 12}} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip content={<CustomTooltip />} cursor={{fill: '#f1f5f9'}} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={40}>
                    {chartData.map((entry, index) => {
                      const colorClass = getColorForType(entry.name);
                      // Extract hex from tailwind class approximation or use default
                      let fill = '#64748b'; // slate-500
                      if (colorClass.includes('green')) fill = '#16a34a';
                      if (colorClass.includes('blue')) fill = '#2563eb';
                      if (colorClass.includes('orange')) fill = '#ea580c';
                      if (colorClass.includes('cyan')) fill = '#0891b2';
                      if (colorClass.includes('purple')) fill = '#9333ea';
                      if (colorClass.includes('indigo')) fill = '#4f46e5';
                      return <Cell key={`cell-${index}`} fill={fill} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="space-y-3">
              {field.types.map((t, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-100">
                  <div className="flex items-center gap-3">
                    <span className={`w-3 h-3 rounded-full ${getColorForType(t.type).replace('text-', 'bg-').split(' ')[1]}`}></span>
                    <span className="font-medium text-slate-700">{t.type}</span>
                  </div>
                  <span className="font-mono text-sm text-slate-500">{Math.round(t.frequency_percent)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Indexes Column */}
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm min-h-[200px]">
            <h2 className="text-lg font-semibold text-slate-800 mb-6 flex items-center gap-2">
              <Link size={20} className="text-slate-400" />
              Linked Indexes
            </h2>

            {relatedIndexes.length > 0 ? (
              <div className="space-y-3">
                {relatedIndexes.map((idx, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 bg-indigo-50 border border-indigo-100 rounded-lg">
                    <Hash size={16} className="text-indigo-500 mt-0.5 shrink-0" />
                    <span className="font-mono text-sm text-indigo-900 break-all">{idx}</span>
                  </div>
                ))}
              </div>
            ) : (
               <div className="text-center py-8 text-slate-400">
                 <p>No indexes specifically explicitly match this field name.</p>
               </div>
            )}
          </div>

          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
             <h2 className="text-lg font-semibold text-slate-800 mb-4">Field Details</h2>
             <div className="space-y-4 text-sm">
                <div className="flex justify-between border-b border-slate-100 pb-2">
                  <span className="text-slate-500">Absolute Path</span>
                  <span className="font-mono text-slate-900">{field.path}</span>
                </div>
                <div className="flex justify-between border-b border-slate-100 pb-2">
                  <span className="text-slate-500">Inferred Type</span>
                  <span className={`px-2 py-0.5 rounded text-xs uppercase font-bold ${getColorForType(field.inferred_type)}`}>{field.inferred_type}</span>
                </div>
                <div className="flex justify-between border-b border-slate-100 pb-2">
                  <span className="text-slate-500">Has Nested Fields</span>
                  <span className="text-slate-900">{field.nested_fields && field.nested_fields.length > 0 ? 'Yes' : 'No'}</span>
                </div>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};