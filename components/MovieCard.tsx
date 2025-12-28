import React, { useState, useEffect } from 'react';
import { Movie, ViewState } from '../types';
import { Icon } from './Icon';

interface MovieCardProps {
  movie: Movie;
  viewType: ViewState;
  onClick: () => void;
}

const MovieCard: React.FC<MovieCardProps> = ({ movie, viewType, onClick }) => {
  const isPlayerView = viewType === 'PLAYER';
  const showPlayButton = viewType === 'SEARCH' || isPlayerView;
  const [imgSrc, setImgSrc] = useState<string>(movie.image);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setImgSrc(movie.image);
    setHasError(false);
  }, [movie.image]);

  const handleImageError = () => {
    if (!hasError) {
      setHasError(true);
      // 使用更稳健的占位图服务
      setImgSrc(`https://images.placeholders.dev/?width=300&height=450&text=${encodeURIComponent(movie.title)}&fontSize=20&bgColor=%231e293b&textColor=%23ffffff`);
    }
  };

  return (
    <div className="group cursor-pointer flex flex-col" onClick={onClick}>
      <div className={`relative overflow-hidden rounded-lg shadow-md transition-all duration-300 ease-out bg-gray-200 dark:bg-slate-700 aspect-[2/3] ${viewType === 'SEARCH' ? 'hover:shadow-xl hover:shadow-primary/20 hover:-translate-y-1' : ''}`}>
        <img 
          src={imgSrc || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'} 
          alt={movie.title} 
          className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-500"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={handleImageError}
        />
        
        {/* Play Button Overlay */}
        <div className={`absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300 flex items-center justify-center ${showPlayButton ? 'opacity-0 group-hover:opacity-100' : ''}`}>
           {showPlayButton && (
             <div className={`rounded-full bg-primary/90 text-white flex items-center justify-center backdrop-blur-sm transform scale-75 group-hover:scale-100 transition-transform duration-300 ${viewType === 'SEARCH' ? 'w-12 h-12' : ''}`}>
                <Icon name={viewType === 'SEARCH' ? 'play_arrow' : 'play_circle_filled'} className={viewType === 'SEARCH' ? 'text-3xl ml-1' : 'text-5xl'} type={viewType === 'SEARCH' ? 'round' : 'outlined'} />
             </div>
           )}
        </div>

        {/* Source Badge */}
        {movie.sourceName && (
          <div className="absolute top-2 left-2 px-2 py-0.5 rounded backdrop-blur-sm text-[10px] shadow-sm bg-purple-600/90 text-white z-10 font-medium">
            {movie.sourceName}
          </div>
        )}

        {/* Quality Badge */}
        {movie.badge && (
          <div className={`absolute top-2 right-2 px-2 py-0.5 rounded backdrop-blur-sm text-[10px] shadow-sm ${movie.badgeColor === 'primary' ? 'bg-primary text-white' : 'bg-black/70 text-white'} z-10 font-bold`}>
            {movie.badge}
          </div>
        )}
      </div>

      <div className="mt-3">
        <h3 className={`text-sm font-semibold text-gray-900 dark:text-white line-clamp-1 group-hover:text-blue-500 transition-colors ${isPlayerView ? 'text-base' : ''}`}>
          {movie.title}
        </h3>
        <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 flex items-center justify-between">
          <div className="flex items-center gap-1">
             <span>{movie.year}</span>
             <span className="w-1 h-1 bg-gray-400 rounded-full"></span>
             <span className="truncate max-w-[80px]">{movie.genre}</span>
          </div>
          {movie.rating && (
            <span className="flex items-center text-yellow-500 font-bold">
              <Icon name="star" type="outlined" className="text-xs mr-0.5" />
              {movie.rating}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default MovieCard;