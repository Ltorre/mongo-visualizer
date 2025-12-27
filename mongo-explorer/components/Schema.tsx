import React, { useState, useEffect } from 'react';
import { ChevronRight, ChevronDown, Hash, Type, AlignLeft, Calendar, CheckSquare, Box, Code, PieChart } from 'lucide-react';
import { Field } from '../types';
import { getColorForType } from '../utils';

interface SchemaNodeProps {
  field: Field;
  depth?: number;
  onSelectField?: (field: Field) => void;
  expandTrigger?: number;
  collapseTrigger?: number;
}

const TypeIcon: React.FC<{ type: string; className?: string }> = ({ type, className }) => {
  const t = type.toLowerCase();
  if (t === 'objectid') return <Hash size={14} className={className} />;
  if (t === 'string') return <AlignLeft size={14} className={className} />;
  if (t === 'date') return <Calendar size={14} className={className} />;
  if (t === 'boolean') return <CheckSquare size={14} className={className} />;
  if (['int32', 'int64', 'double', 'number'].includes(t)) return <Hash size={14} className={className} />;
  if (t === 'array') return <Code size={14} className={className} />;
  if (t === 'object') return <Box size={14} className={className} />;
  return <Type size={14} className={className} />;
};

export const SchemaNode: React.FC<SchemaNodeProps> = ({ 
  field, 
  depth = 0, 
  onSelectField,
  expandTrigger = 0,
  collapseTrigger = 0
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const hasChildren = field.nested_fields && field.nested_fields.length > 0;
  const isObject = field.inferred_type === 'object';
  
  // Auto-expand top level objects if they aren't too deep
  useEffect(() => {
    if (depth < 1 && isObject) setIsOpen(true);
  }, [depth, isObject]);

  // Handle Expand All
  useEffect(() => {
    if (expandTrigger > 0 && hasChildren) {
      setIsOpen(true);
    }
  }, [expandTrigger, hasChildren]);

  // Handle Collapse All
  useEffect(() => {
    if (collapseTrigger > 0 && hasChildren) {
      setIsOpen(false);
    }
  }, [collapseTrigger, hasChildren]);

  const typeColorClass = getColorForType(field.inferred_type);

  return (
    <div className="select-none group/row">
      <div 
        className={`
          flex items-center py-2 px-3 hover:bg-slate-50 border-b border-slate-50 transition-colors
          ${depth > 0 ? 'border-l-2 border-slate-100' : ''}
        `}
        style={{ paddingLeft: `${depth * 1.5 + 0.75}rem` }}
      >
        <div 
          className="w-5 flex justify-center mr-2 text-slate-400 cursor-pointer"
          onClick={() => hasChildren && setIsOpen(!isOpen)}
        >
          {hasChildren && (
            isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />
          )}
        </div>
        
        <div 
            className="flex-1 flex items-center gap-3 overflow-hidden cursor-pointer"
            onClick={() => hasChildren && setIsOpen(!isOpen)}
        >
          <span className="font-mono text-sm font-medium text-slate-700 truncate" title={field.path}>
            {field.path.split('.').pop()}
          </span>
          
          <span className={`text-[10px] px-2 py-0.5 rounded-full border flex items-center gap-1 font-medium uppercase tracking-wider ${typeColorClass}`}>
            <TypeIcon type={field.inferred_type} />
            {field.inferred_type}
          </span>

          {field.types.length > 1 && (
             <span className="text-xs text-slate-400 italic">
               (Mixed: {field.types.map(t => t.type).join(', ')})
             </span>
          )}
        </div>

        <div className="flex items-center gap-4">
           {onSelectField && (
             <button 
               onClick={(e) => {
                 e.stopPropagation();
                 onSelectField(field);
               }}
               className="opacity-0 group-hover/row:opacity-100 transition-opacity p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md"
               title="Analyze Field Types & Indexes"
             >
               <PieChart size={16} />
             </button>
           )}

           <div className="w-32 flex flex-col items-end">
             <div className="flex items-center gap-1">
               <div className="h-1.5 w-16 bg-slate-100 rounded-full overflow-hidden">
                 <div 
                   className={`h-full rounded-full ${field.presence_percent > 90 ? 'bg-emerald-400' : field.presence_percent > 50 ? 'bg-amber-400' : 'bg-red-400'}`} 
                   style={{ width: `${field.presence_percent}%` }}
                 />
               </div>
               <span className="text-xs text-slate-500 font-mono w-10 text-right">{Math.round(field.presence_percent)}%</span>
             </div>
           </div>
        </div>
      </div>

      {hasChildren && isOpen && (
        <div className="animate-in slide-in-from-top-1 duration-200">
          {field.nested_fields!.map((child, idx) => (
            <SchemaNode 
              key={idx} 
              field={child} 
              depth={depth + 1} 
              onSelectField={onSelectField}
              expandTrigger={expandTrigger}
              collapseTrigger={collapseTrigger}
            />
          ))}
        </div>
      )}
    </div>
  );
};