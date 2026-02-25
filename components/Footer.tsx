import React from 'react';
import { ViewState } from '../types';
import { Icon } from './Icon';

interface FooterProps {
  currentView: ViewState;
}

const Footer: React.FC<FooterProps> = ({ currentView }) => {
  return (
    <footer className="bg-white dark:bg-slate-800 border-t border-gray-200 dark:border-gray-700 py-8 mt-auto transition-colors duration-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row justify-between items-center gap-4">
        {currentView === 'PLAYER' ? (
           <div className="flex items-center gap-2">
             <Icon name="play_circle" className="text-blue-600" type="outlined" />
             <span className="font-semibold text-gray-900 dark:text-white">StreamHub</span>
           </div>
        ) : (
           <p className="text-sm text-gray-500 dark:text-gray-400">©  {currentView === 'SEARCH' ? 'VideoHub' : 'StreamHub'}. 保留所有权利。</p>
        )}
        
        {currentView === 'PLAYER' ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">
            ©  StreamHub Inc. 版权所有。
          </div>
        ) : (
          <div className="flex space-x-6 text-sm text-gray-500 dark:text-gray-400">
            <a href="#" className="hover:text-blue-600 transition-colors">欢迎使用</a>
            <a href="#" className="hover:text-blue-600 transition-colors">保持低调</a>
            <a href="https://cfkua.wokaotianshi.eu.org/https://raw.githubusercontent.com/wokaotianshi123/streamhub/refs/heads/main/steamhub4.0latest.apk" className="hover:text-blue-600 transition-colors">下载apk</a>
          </div>
        )}

        {currentView === 'PLAYER' && (
          <div className="flex gap-4">
            <a href="#" className="text-gray-500 dark:text-gray-400 hover:text-blue-600 transition-colors"><Icon name="facebook" type="outlined" /></a>
            <a href="#" className="text-gray-500 dark:text-gray-400 hover:text-blue-600 transition-colors"><Icon name="smart_display" type="outlined" /></a>
            <a href="#" className="text-gray-500 dark:text-gray-400 hover:text-blue-600 transition-colors"><Icon name="photo_camera" type="outlined" /></a>
          </div>
        )}
      </div>
    </footer>
  );
};

export default Footer;
