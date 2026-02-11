
import React, { useState, useEffect, useRef } from 'react';
import { Movie, ViewState } from '../types';
import { Icon } from './Icon';

interface MovieCardProps {
  movie: Movie;
  viewType: ViewState;
  onClick: (movie: Movie) => void;
}

const MovieCard: React.FC<MovieCardProps> = ({ movie, viewType, onClick }) => {
  const isPlayerView = viewType === 'PLAYER';
  const showPlayButton = viewType === 'SEARCH' || isPlayerView;
  
  const [imgSrc, setImgSrc] = useState<string>(movie.image);
  const [hasError, setHasError] = useState(false);
  const [showSourceSelector, setShowSourceSelector] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setImgSrc(movie.image);
    setHasError(false);
  }, [movie.image]);

  useEffect(() => {
    if (showSourceSelector && selectorRef.current) {
        // 当浮层显示时，尝试聚焦第一个选项
        const firstBtn = selectorRef.current.querySelector('div[tabIndex="0"]') as HTMLElement;
        if (firstBtn) firstBtn.focus();
    }
  }, [showSourceSelector]);

  const handleImageError = () => {
    if (hasError) return;
    setImgSrc(`https://images.placeholders.dev/?width=300&height=450&text=${encodeURIComponent(movie.title || '暂无封面')}&fontSize=20&bgColor=%231e293b&textColor=%23ffffff`);
    setHasError(true);
  };

  const handleSourceClick = (e: React.MouseEvent | React.KeyboardEvent, api: string, name: string, vodId?: string) => {
      e.stopPropagation();
      onClick({ 
          ...movie, 
          sourceApi: api, 
          sourceName: name, 
          id: vodId || movie.id, 
          vod_id: vodId || movie.vod_id 
      });
      setShowSourceSelector(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent, api: string, name: string, vodId?: string) => {
      if (e.key === 'Enter') {
          handleSourceClick(e, api, name, vodId);
      }
  };

  const handleToggleSelector = (e: React.MouseEvent | React.KeyboardEvent) => {
      e.stopPropagation();
      setShowSourceSelector(!showSourceSelector);
  };

  const hasMultipleSources = movie.availableSources && movie.availableSources.length > 1;

  return (
    <div 
        className="group cursor-pointer flex flex-col relative w-full h-full outline-none focus:ring-4 focus:ring-blue-500 rounded-xl" 
        onClick={() => !showSourceSelector && onClick(movie)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !showSourceSelector) onClick(movie); }}
        tabIndex={0}
        onMouseLeave={() => setShowSourceSelector(false)}
    >
      {/* 封面图容器 */}
      <div className={`relative overflow-hidden rounded-xl shadow-sm transition-all duration-300 ease-out bg-gray-200 dark:bg-slate-800 w-full pb-[145%] ring-1 ring-black/5 dark:ring-white/5 ${viewType !== 'HOME' ? 'hover:shadow-xl hover:shadow-primary/20 hover:-translate-y-1' : 'hover:ring-blue-500'}`}>
        <img 
          src={imgSrc || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'} 
          alt={movie.title} 
          className="absolute inset-0 w-full h-full object-cover block"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={handleImageError}
        />
        
        <div className={`absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all duration-300 flex items-center justify-center`}>
           {showPlayButton ? (
             <div className="rounded-full bg-blue-600 text-white w-12 h-12 flex items-center justify-center transform scale-0 group-hover:scale-100 transition-transform duration-300 shadow-xl">
                <Icon name="play_arrow" className="text-3xl ml-1" />
             </div>
           ) : (
             movie.isDouban && (
               <div className="bg-pink-600/90 text-white px-4 py-2 rounded-full text-xs font-bold transform translate-y-4 group-hover:translate-y-0 opacity-0 group-hover:opacity-100 transition-all shadow-lg">
                  立即检索
               </div>
             )
           )}
        </div>

        <div className="absolute top-2 left-2 right-2 z-20 flex flex-col space-y-1 pointer-events-none">
            {movie.sourceName && !movie.isDouban && (
                <div className="self-start px-1.5 py-0.5 rounded-md bg-blue-600/90 text-white text-[10px] font-bold shadow-sm border border-white/10 backdrop-blur-md truncate max-w-full">
                    {movie.sourceName}
                </div>
            )}
            
            <div className="flex items-center justify-between w-full">
                {movie.year ? (
                    <div className="px-1.5 py-0.5 rounded-md bg-black/60 text-white text-[10px] font-bold shadow-sm border border-white/10 backdrop-blur-md">
                        {movie.year}
                    </div>
                ) : <div></div>}
                
                {movie.badge && (
                    <div className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold shadow-sm border border-white/10 backdrop-blur-md ${movie.badgeColor === 'primary' ? 'bg-amber-500 text-white' : 'bg-black/60 text-white'}`}>
                        {movie.badge}
                    </div>
                )}
            </div>
        </div>

        <div className="absolute bottom-2 left-2 right-2 flex justify-between items-center pointer-events-none z-20">
             {movie.rating && movie.rating > 0 && (
                <div className="bg-black/70 backdrop-blur-sm text-yellow-400 px-2 py-0.5 rounded-md text-[11px] font-bold flex items-center space-x-1 border border-white/5">
                    <Icon name="star" className="text-[12px]" />
                    <span>{movie.rating.toFixed(1)}</span>
                </div>
             )}

             {hasMultipleSources && (
                 <div 
                    className="ml-auto pointer-events-auto bg-gray-800/90 hover:bg-gray-700 backdrop-blur-md text-white px-2 py-0.5 rounded-md text-[11px] font-bold flex items-center space-x-1 border border-white/10 cursor-pointer transition-colors shadow-lg outline-none focus:ring-2 focus:ring-blue-500 focus:bg-blue-600"
                    onMouseEnter={() => setShowSourceSelector(true)}
                    onClick={handleToggleSelector}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleToggleSelector(e); }}
                    tabIndex={0}
                 >
                     <span className="font-black text-white">{movie.availableSources?.length}</span>
                     <span className="text-gray-300">源</span>
                 </div>
             )}
        </div>

        {showSourceSelector && hasMultipleSources && (
            <div 
                ref={selectorRef} 
                className="absolute bottom-10 right-2 w-40 bg-gray-800/95 backdrop-blur-xl rounded-xl border border-gray-600 shadow-2xl z-30 overflow-hidden animate-fadeIn flex flex-col p-1"
            >
                 <div className="text-[10px] text-gray-400 px-2 py-1.5 border-b border-gray-700 font-bold flex items-center space-x-1">
                     <Icon name="auto_awesome" className="text-xs text-purple-400" />
                     <span>请选择片源</span>
                 </div>
                 <div className="max-h-48 overflow-y-auto custom-scrollbar">
                     {movie.availableSources?.map((src, idx) => (
                         <div 
                            key={idx}
                            tabIndex={0}
                            onClick={(e) => handleSourceClick(e, src.api, src.name, src.vodId)}
                            onKeyDown={(e) => handleKeyDown(e, src.api, src.name, src.vodId)}
                            className="px-3 py-2 text-xs text-gray-200 hover:bg-blue-600 focus:bg-blue-600 hover:text-white focus:text-white cursor-pointer transition-colors flex items-center space-x-2 rounded-lg m-0.5 outline-none"
                         >
                             <Icon name="movie" className="text-[12px] opacity-70" />
                             <span className="truncate">{src.name}</span>
                         </div>
                     ))}
                 </div>
            </div>
        )}
      </div>

      <div className="mt-2 px-0.5 pb-1">
        <h3 className={`text-sm font-bold text-gray-900 dark:text-white line-clamp-2 leading-snug h-10 overflow-hidden group-hover:text-blue-500 transition-colors ${isPlayerView ? 'text-base h-auto line-clamp-none' : ''}`} title={movie.title}>
          {movie.title}
        </h3>
        {!isPlayerView && (
            <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 flex items-center justify-between">
              <span className="truncate">{movie.genre || '影视'}</span>
            </div>
        )}
      </div>
    </div>
  );
};

export default MovieCard;
