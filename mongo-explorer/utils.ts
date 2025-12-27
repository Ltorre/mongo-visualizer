export const formatBytes = (bytes: number, decimals = 2) => {
  if (!+bytes) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

export const formatNumber = (num: number) => {
  return new Intl.NumberFormat('en-US', { notation: "compact", maximumFractionDigits: 1 }).format(num);
};

export const getColorForType = (type: string) => {
  switch (type.toLowerCase()) {
    case 'objectid': return 'text-purple-600 bg-purple-50 border-purple-200';
    case 'string': return 'text-green-600 bg-green-50 border-green-200';
    case 'date': return 'text-blue-600 bg-blue-50 border-blue-200';
    case 'boolean': return 'text-orange-600 bg-orange-50 border-orange-200';
    case 'int32': 
    case 'int64':
    case 'double':
    case 'number': return 'text-cyan-600 bg-cyan-50 border-cyan-200';
    case 'array': return 'text-indigo-600 bg-indigo-50 border-indigo-200';
    case 'object': return 'text-slate-600 bg-slate-100 border-slate-200';
    default: return 'text-gray-600 bg-gray-50 border-gray-200';
  }
};
