
import React from 'react';
import { Theme } from '../types';

interface ThemeCardProps {
  theme: Theme;
  isSelected: boolean;
  onClick: (theme: Theme) => void;
}

const ThemeCard: React.FC<ThemeCardProps> = ({ theme, isSelected, onClick }) => {
  return (
    <button
      onClick={() => onClick(theme)}
      className={`p-6 rounded-[2.5rem] border-4 transition-all duration-500 flex flex-col items-center justify-center gap-3 group relative overflow-hidden
        ${isSelected 
          ? 'border-orange-400 bg-orange-50 shadow-2xl scale-110 -rotate-2' 
          : 'border-white bg-white shadow-lg hover:border-orange-200 hover:shadow-xl hover:-translate-y-2'
        }`}
    >
      {isSelected && (
        <div className="absolute top-0 right-0 p-2">
          <div className="w-3 h-3 bg-orange-400 rounded-full animate-ping"></div>
        </div>
      )}
      <div className={`w-20 h-20 rounded-[2rem] flex items-center justify-center text-5xl transition-all duration-500 shadow-inner
        ${isSelected ? 'bg-white scale-110' : 'bg-slate-50 group-hover:bg-orange-50 group-hover:scale-110'}`}>
        {theme.icon}
      </div>
      <span className={`font-black text-center text-sm md:text-base tracking-tight transition-colors
        ${isSelected ? 'text-orange-600' : 'text-slate-600 group-hover:text-orange-500'}`}>
        {theme.label}
      </span>
    </button>
  );
};

export default ThemeCard;
