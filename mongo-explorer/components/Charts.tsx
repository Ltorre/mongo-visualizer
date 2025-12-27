import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { formatBytes } from '../utils';

interface SizeChartProps {
  data: { name: string; size: number }[];
}

export const SizeChart: React.FC<SizeChartProps> = ({ data }) => {
  // Sort and take top 10 for readability
  const sortedData = [...data].sort((a, b) => b.size - a.size).slice(0, 10);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-3 border border-slate-100 shadow-xl rounded-lg">
          <p className="font-semibold text-slate-800">{label}</p>
          <p className="text-indigo-600 font-medium">
            {formatBytes(payload[0].value)}
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={sortedData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <XAxis type="number" hide />
          <YAxis 
            dataKey="name" 
            type="category" 
            width={120} 
            tick={{fontSize: 11, fill: '#64748b'}} 
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{fill: '#f1f5f9'}} />
          <Bar dataKey="size" radius={[0, 4, 4, 0]} barSize={20}>
            {sortedData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={index < 3 ? '#4f46e5' : '#94a3b8'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};
