import React, { useState, useCallback, useEffect } from 'react';
import { Upload, FileJson, AlertCircle, Play } from 'lucide-react';
import { ClusterScan, Database, Collection, ViewLevel, BreadcrumbItem, Field } from './types';
import { ClusterView, DatabaseView, CollectionView, FieldView } from './views/Levels';

const DEFAULT_SCHEMA_URL = 'https://raw.githubusercontent.com/Ltorre/mongo-visualizer/main/mongo-scanner/sample-schema.json';
const SESSION_STORAGE_KEY = 'mongo-c4-explorer.session.v1';

interface ExplorerRoute {
  level: ViewLevel;
  databaseName?: string;
  collectionName?: string;
  fieldPath?: string;
}

interface PersistedSession {
  data: ClusterScan;
  clusterName: string;
}

const clusterRoute = (): ExplorerRoute => ({ level: ViewLevel.CLUSTER });

const decodeRoutePart = (part: string) => {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
};

const parseRoute = (hash: string): ExplorerRoute => {
  const parts = hash.replace(/^#/, '').split('/');
  const kind = parts[0];
  const databaseName = parts[1] ? decodeRoutePart(parts[1]) : null;
  const collectionName = parts[2] ? decodeRoutePart(parts[2]) : null;
  const fieldPath = parts[3] ? decodeRoutePart(parts[3]) : null;

  if (kind === 'database' && databaseName) {
    return { level: ViewLevel.DATABASE, databaseName };
  }
  if (kind === 'collection' && databaseName && collectionName) {
    return { level: ViewLevel.COLLECTION, databaseName, collectionName };
  }
  if (kind === 'field' && databaseName && collectionName && fieldPath) {
    return { level: ViewLevel.FIELD, databaseName, collectionName, fieldPath };
  }
  return clusterRoute();
};

const routeToHash = (route: ExplorerRoute) => {
  const encode = (value?: string) => encodeURIComponent(value || '');
  if (route.level === ViewLevel.DATABASE && route.databaseName) {
    return `#database/${encode(route.databaseName)}`;
  }
  if (route.level === ViewLevel.COLLECTION && route.databaseName && route.collectionName) {
    return `#collection/${encode(route.databaseName)}/${encode(route.collectionName)}`;
  }
  if (route.level === ViewLevel.FIELD && route.databaseName && route.collectionName && route.fieldPath) {
    return `#field/${encode(route.databaseName)}/${encode(route.collectionName)}/${encode(route.fieldPath)}`;
  }
  return '#cluster';
};

const sameRoute = (left: ExplorerRoute, right: ExplorerRoute) => (
  left.level === right.level &&
  left.databaseName === right.databaseName &&
  left.collectionName === right.collectionName &&
  left.fieldPath === right.fieldPath
);

const findField = (fields: Field[], path: string): Field | null => {
  for (const field of fields) {
    if (field.path === path) {
      return field;
    }
    const nestedField = field.nested_fields ? findField(field.nested_fields, path) : null;
    if (nestedField) {
      return nestedField;
    }
  }
  return null;
};

const normalizeRoute = (route: ExplorerRoute, data: ClusterScan | null): ExplorerRoute => {
  if (!data || route.level === ViewLevel.CLUSTER) {
    return clusterRoute();
  }

  const database = route.databaseName
    ? data.databases.find((candidate) => candidate.name === route.databaseName)
    : null;
  if (!database) {
    return clusterRoute();
  }
  if (route.level === ViewLevel.DATABASE) {
    return { level: ViewLevel.DATABASE, databaseName: database.name };
  }

  const collection = route.collectionName
    ? database.collections.find((candidate) => candidate.name === route.collectionName)
    : null;
  if (!collection) {
    return { level: ViewLevel.DATABASE, databaseName: database.name };
  }
  if (route.level === ViewLevel.COLLECTION) {
    return { level: ViewLevel.COLLECTION, databaseName: database.name, collectionName: collection.name };
  }

  const field = route.fieldPath ? findField(collection.fields, route.fieldPath) : null;
  if (!field) {
    return {
      level: ViewLevel.COLLECTION,
      databaseName: database.name,
      collectionName: collection.name,
    };
  }
  return {
    level: ViewLevel.FIELD,
    databaseName: database.name,
    collectionName: collection.name,
    fieldPath: field.path,
  };
};

const readPersistedSession = (): PersistedSession | null => {
  try {
    const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<PersistedSession>;
    if (!parsed.data || !Array.isArray(parsed.data.databases)) {
      return null;
    }
    return {
      data: parsed.data,
      clusterName: parsed.clusterName || parsed.data.cluster_name || 'Cluster-Home',
    };
  } catch {
    return null;
  }
};

function App() {
  const [initialSession] = useState<PersistedSession | null>(readPersistedSession);
  const [data, setData] = useState<ClusterScan | null>(() => initialSession?.data || null);
  const [clusterName, setClusterName] = useState(() => initialSession?.clusterName || 'Cluster-Home');
  const [route, setRoute] = useState<ExplorerRoute>(() => parseRoute(window.location.hash));
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const currentLevel = route.level;
  const selectedDatabase = data && route.databaseName
    ? data.databases.find((candidate) => candidate.name === route.databaseName) || null
    : null;
  const selectedCollection = selectedDatabase && route.collectionName
    ? selectedDatabase.collections.find((candidate) => candidate.name === route.collectionName) || null
    : null;
  const selectedField = selectedCollection && route.fieldPath
    ? findField(selectedCollection.fields, route.fieldPath)
    : null;

  const replaceRoute = (nextRoute: ExplorerRoute) => {
    setRoute(nextRoute);
    window.history.replaceState({ mongoExplorerRoute: nextRoute }, '', routeToHash(nextRoute));
  };

  const navigateToRoute = (nextRoute: ExplorerRoute) => {
    const normalizedRoute = normalizeRoute(nextRoute, data);
    if (sameRoute(normalizedRoute, route)) {
      return;
    }
    setRoute(normalizedRoute);
    window.history.pushState({ mongoExplorerRoute: normalizedRoute }, '', routeToHash(normalizedRoute));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    const initialRoute = normalizeRoute(parseRoute(window.location.hash), data);
    setRoute(initialRoute);
    window.history.replaceState({ mongoExplorerRoute: initialRoute }, '', routeToHash(initialRoute));

    const handleHistoryNavigation = () => {
      setRoute(parseRoute(window.location.hash));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    window.addEventListener('popstate', handleHistoryNavigation);
    window.addEventListener('hashchange', handleHistoryNavigation);
    return () => {
      window.removeEventListener('popstate', handleHistoryNavigation);
      window.removeEventListener('hashchange', handleHistoryNavigation);
    };
  }, [data]);

  useEffect(() => {
    const normalizedRoute = normalizeRoute(route, data);
    if (!sameRoute(normalizedRoute, route)) {
      replaceRoute(normalizedRoute);
    }
  }, [data, route]);

  useEffect(() => {
    if (!data) {
      return;
    }
    try {
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ data, clusterName }));
    } catch (storageError) {
      console.warn('Could not persist the current schema for refresh recovery.', storageError);
    }
  }, [data, clusterName]);

  const handleLoadedSchema = (json: ClusterScan) => {
    setData(json);
    setClusterName(json.cluster_name || 'Cluster-Home');
    replaceRoute(clusterRoute());
    setError(null);
  };

  const handleFileUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        // Simple validation
        if (!json.databases || !Array.isArray(json.databases)) {
          throw new Error("Invalid JSON structure: missing 'databases' array.");
        }
        handleLoadedSchema(json);
      } catch (err) {
        setError("Failed to parse JSON. Please ensure it's a valid MongoDB scan file.");
      }
    };
    reader.readAsText(file);
  };

  const loadDefaultSchema = async () => {
    try {
      const response = await fetch(`${DEFAULT_SCHEMA_URL}?ts=${Date.now()}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`Failed to load file (Status: ${response.status})`);
      }
      const json = await response.json();
      
      // Simple validation
      if (!json.databases || !Array.isArray(json.databases)) {
        throw new Error("Invalid JSON structure: missing 'databases' array.");
      }
      handleLoadedSchema(json);
    } catch (err) {
       console.error(err);
       setError("Could not load the GitHub sample schema. Check the network connection and try again.");
    }
  };

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  }, []);

  const handleSelectDatabase = (db: Database) => {
    navigateToRoute({ level: ViewLevel.DATABASE, databaseName: db.name });
  };

  const handleSelectCollection = (col: Collection) => {
    if (selectedDatabase) {
      navigateToRoute({
        level: ViewLevel.COLLECTION,
        databaseName: selectedDatabase.name,
        collectionName: col.name,
      });
    }
  };

  const handleSelectField = (field: Field) => {
    if (selectedDatabase && selectedCollection) {
      navigateToRoute({
        level: ViewLevel.FIELD,
        databaseName: selectedDatabase.name,
        collectionName: selectedCollection.name,
        fieldPath: field.path,
      });
    }
  };

  const navigateToLevel = (level: ViewLevel) => {
    if (level === ViewLevel.CLUSTER) {
      navigateToRoute(clusterRoute());
    } else if (level === ViewLevel.DATABASE) {
      if (selectedDatabase) {
        navigateToRoute({ level: ViewLevel.DATABASE, databaseName: selectedDatabase.name });
      }
    } else if (level === ViewLevel.COLLECTION) {
      if (selectedDatabase && selectedCollection) {
        navigateToRoute({
          level: ViewLevel.COLLECTION,
          databaseName: selectedDatabase.name,
          collectionName: selectedCollection.name,
        });
      }
    }
  };

  if (!data) {
    return (
      <div 
        className={`min-h-screen flex items-center justify-center p-4 transition-colors duration-300 ${isDragging ? 'bg-indigo-50' : 'bg-slate-50'}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <div className="max-w-xl w-full">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center">
            <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <FileJson size={32} />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mb-2">Mongo C4 Explorer</h1>
            <p className="text-slate-500 mb-8">
              Upload your MongoDB scan JSON file to visualize your cluster structure using the C4 model abstraction layers.
            </p>
            
            <label className="block w-full cursor-pointer">
              <input 
                type="file" 
                className="hidden" 
                accept="application/json" 
                onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
              />
              <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 hover:border-indigo-500 hover:bg-indigo-50 transition-all group">
                <Upload className="mx-auto text-slate-400 group-hover:text-indigo-500 mb-3 transition-colors" size={24} />
                <span className="font-semibold text-indigo-600">Click to upload</span>
                <span className="text-slate-500"> or drag and drop JSON here</span>
              </div>
            </label>

            <div className="mt-6 pt-6 border-t border-slate-100">
               <button 
                  onClick={loadDefaultSchema}
                  className="mx-auto flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium transition-colors"
                >
                  <Play size={16} className="text-indigo-600" />
                  Load GitHub sample schema
               </button>
            </div>

            {error && (
              <div className="mt-6 p-4 bg-red-50 text-red-700 rounded-lg flex items-center gap-3 text-left animate-in fade-in slide-in-from-bottom-2">
                <AlertCircle size={20} className="shrink-0" />
                <p className="text-sm">{error}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-12">
      {/* Navbar */}
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-50 backdrop-blur-sm bg-white/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center h-16 gap-4">
            <div 
              className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => navigateToLevel(ViewLevel.CLUSTER)}
            >
              <div className="w-8 h-8 bg-indigo-600 text-white rounded-lg flex items-center justify-center font-bold">C4</div>
              <span className="font-bold text-slate-900 hidden sm:block">Mongo Explorer</span>
            </div>

            <div className="h-6 w-px bg-slate-200 mx-2"></div>

            {/* Breadcrumbs */}
            <div className="flex items-center gap-2 text-sm overflow-x-auto no-scrollbar whitespace-nowrap">
              <button 
                onClick={() => navigateToLevel(ViewLevel.CLUSTER)}
                className={`px-3 py-1.5 rounded-md transition-colors ${currentLevel === ViewLevel.CLUSTER ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-slate-500 hover:bg-slate-50'}`}
              >
                Cluster Home
              </button>
              
              {currentLevel !== ViewLevel.CLUSTER && selectedDatabase && (
                <>
                  <span className="text-slate-300">/</span>
                  <button 
                    onClick={() => navigateToLevel(ViewLevel.DATABASE)}
                    className={`px-3 py-1.5 rounded-md transition-colors flex items-center gap-2 ${currentLevel === ViewLevel.DATABASE ? 'bg-emerald-50 text-emerald-700 font-medium' : 'text-slate-500 hover:bg-slate-50'}`}
                  >
                    {selectedDatabase.name}
                  </button>
                </>
              )}

              {selectedCollection && (
                <>
                  <span className="text-slate-300">/</span>
                  <button 
                     onClick={() => navigateToLevel(ViewLevel.COLLECTION)}
                     className={`px-3 py-1.5 rounded-md transition-colors flex items-center gap-2 ${currentLevel === ViewLevel.COLLECTION ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-500 hover:bg-slate-50'}`}
                  >
                    {selectedCollection.name}
                  </button>
                </>
              )}

              {currentLevel === ViewLevel.FIELD && selectedField && (
                <>
                  <span className="text-slate-300">/</span>
                  <button 
                    className="px-3 py-1.5 rounded-md bg-purple-50 text-purple-700 font-medium flex items-center gap-2"
                  >
                    {selectedField.path.split('.').pop()}
                  </button>
                </>
              )}
            </div>

            <div className="ml-auto">
                <button 
                    onClick={() => {
                      setData(null);
                      setError(null);
                      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
                      replaceRoute(clusterRoute());
                    }}
                    className="text-xs font-medium text-slate-500 hover:text-slate-800 border border-slate-200 rounded px-3 py-1.5 hover:bg-slate-50 transition-colors"
                >
                    Close File
                </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {currentLevel === ViewLevel.CLUSTER && (
          <ClusterView 
            data={data} 
            clusterName={clusterName} 
            onRenameCluster={setClusterName} 
            onSelectDatabase={handleSelectDatabase} 
          />
        )}
        
        {currentLevel === ViewLevel.DATABASE && selectedDatabase && (
          <DatabaseView 
            database={selectedDatabase} 
            onSelectCollection={handleSelectCollection} 
          />
        )}

        {currentLevel === ViewLevel.COLLECTION && selectedCollection && (
          <CollectionView 
            collection={selectedCollection} 
            onSelectField={handleSelectField}
          />
        )}

        {currentLevel === ViewLevel.FIELD && selectedField && selectedCollection && (
          <FieldView 
            field={selectedField}
            collection={selectedCollection}
          />
        )}
      </main>
    </div>
  );
}

export default App;
