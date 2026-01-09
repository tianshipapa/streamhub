
import React from 'react';
import { Movie } from '../types';
import MovieCard from '../components/MovieCard';
import { Icon } from '../components/Icon';

interface DoubanListProps {
  movies: Movie[];
  loading: boolean;
  error: boolean;
  tag: string;
  onLoadMore: () => void;
  onRetry: () => void;
  onMovieClick: (movie: Movie) => void;
}

const DoubanList: React.FC<DoubanListProps> = ({
  movies,
  loading,
  error,
  tag,
  onLoadMore,
  onRetry,
  onMovieClick
}) => {
  // 独立的加载中状态（无数据时）
  if (loading && movies.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 animate-fadeIn">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-pink-500"></div>
        <p className="text-sm text-gray-400">正在获取豆瓣推荐...</p>
      </div>
    );
  }

  // 独立的错误状态（无数据时）
  if (error && movies.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center animate-fadeIn">
        <Icon name="error_outline" className="text-5xl text-gray-300 mb-4" />
        <p className="text-gray-500 mb-2">获取豆瓣数据失败</p>
        <button 
          onClick={onRetry} 
          className="text-pink-500 hover:underline px-4 py-2 rounded-lg hover:bg-pink-50 dark:hover:bg-pink-900/10 transition-colors"
        >
          点击重试
        </button>
      </div>
    );
  }

  return (
    <div className="animate-fadeIn">
      {/* 列表网格 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-4 gap-y-10 sm:gap-x-6">
        {movies.map((movie) => (
          <MovieCard 
            key={`douban-${movie.id}`} 
            movie={movie} 
            viewType="HOME" 
            onClick={() => onMovieClick(movie)} 
          />
        ))}
      </div>

      {/* 底部加载状态/按钮 */}
      {movies.length > 0 && (
        <div className="mt-16 flex justify-center pb-12">
          {error ? (
            <button 
                onClick={onRetry} 
                className="flex items-center gap-2 px-6 py-3 rounded-full bg-red-50 text-red-500 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/30 transition-colors font-bold"
            >
                <Icon name="refresh" /> 加载失败，点击重试
            </button>
          ) : (
            <button 
                onClick={onLoadMore} 
                disabled={loading} 
                className={`flex items-center gap-3 px-10 py-3.5 rounded-full font-bold transition-all shadow-lg ${
                loading 
                    ? 'bg-gray-100 dark:bg-slate-800 text-gray-400 cursor-not-allowed' 
                    : 'bg-white dark:bg-slate-800 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700 hover:border-pink-500 dark:hover:border-pink-500'
                }`}
            >
                {loading ? (
                    <>
                        <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
                        加载中...
                    </>
                ) : (
                    '加载更多推荐'
                )}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default DoubanList;
