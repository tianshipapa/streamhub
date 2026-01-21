
import React, { useState, useEffect, useRef } from 'react';
import { ViewState } from '../types';
import { Icon } from './Icon';

interface HeaderProps {
  currentView: ViewState;
  setView: (view: ViewState) => void;
  onBack: () => void;
  onSearch: (query: string, autoAggregate?: boolean) => void;
}

// 扩充的热词库
const HOT_SEARCHES = [
    '庆余年', '歌手2024', '间谍过家家', '复仇者联盟', '沙丘', '周处除三害', '突袭', '死侍与金刚狼', 
    '抓娃娃', '默杀', '异形：夺命舰', '黑神话', '海贼王', '咒术回战', '凡人修仙传'
];

// 极其丰富的模拟数据库，用于“智能”联想
const MOCK_DATABASE = [
    // --- 热门电影 ---
    '疯狂的石头', '疯狂的赛车', '疯狂动物城', '疯狂的麦克斯', '疯狂的外星人', '疯狂原始人',
    '流浪地球', '流浪地球2', '战狼', '战狼2', '长津湖', '红海行动', '哪吒之魔童降世',
    '满江红', '孤注一掷', '消失的她', '八角笼中', '封神第一部', '长安三万里',
    '热辣滚烫', '飞驰人生', '飞驰人生2', '第二十条', '周处除三害', '九龙城寨之围城',
    '抓娃娃', '默杀', '异形：夺命舰', '死侍与金刚狼', '哥斯拉大战金刚2', '功夫熊猫4',
    '沙丘', '沙丘2', '奥本海默', '芭比', '碟中谍7', '速度与激情10', '阿凡达',
    
    // --- 经典系列 ---
    '复仇者联盟', '复仇者联盟2', '复仇者联盟3', '复仇者联盟4', '钢铁侠', '美国队长', '雷神',
    '蜘蛛侠', '蜘蛛侠：纵横宇宙', '蝙蝠侠：黑暗骑士', '正义联盟', '神奇女侠',
    '哈利波特', '指环王', '霍比特人', '星球大战', '变形金刚', '黑客帝国',
    '教父', '肖申克的救赎', '阿甘正传', '泰坦尼克号', '盗梦空间', '星际穿越', '楚门的世界',
    '让子弹飞', '霸王别姬', '无间道', '大话西游', '功夫', '卧虎藏龙',

    // --- 热门剧集 ---
    '庆余年', '庆余年2', '赘婿', '雪中悍刀行', '繁花', '狂飙', '漫长的季节', '三体',
    '与凤行', '承欢记', '惜花芷', '花博', '玫瑰的故事', '长相思', '莲花楼',
    '甄嬛传', '如懿传', '延禧攻略', '知否知否应是绿肥红瘦', '琅琊榜', '伪装者',
    '权力的游戏', '绝命毒师', '风骚律师', '怪奇物语', '黑镜', '神探夏洛克',
    '请回答1988', '黑暗荣耀', '鱿鱼游戏', '来自星星的你', '鬼怪',

    // --- 动漫/动画 ---
    '间谍过家家', '海贼王', '火影忍者', '死神', '七龙珠', '名侦探柯南', '哆啦A梦', '蜡笔小新',
    '咒术回战', '鬼灭之刃', '进击的巨人', '电锯人', '一拳超人', '灵能百分百',
    '葬送的芙莉莲', '我推的孩子', '排球少年', '灌篮高手', '网球王子',
    '凡人修仙传', '完美世界', '斗破苍穹', '斗罗大陆', '吞噬星空', '仙逆', '遮天',
    '秦时明月', '画江湖之不良人', '罗小黑战记', '雾山五行', '刺客伍六七',
    '千与千寻', '龙猫', '哈尔的移动城堡', '你的名字', '铃芽之旅',

    // --- 动作/犯罪 ---
    '突袭', '突袭2', '疾速追杀', '疾速追杀4', '伸冤人', '谍影重重', '007',
    '杀破狼', '导火线', '叶问', '霍元甲', '精武英雄',
    
    // --- 综艺/纪录片 ---
    '歌手2024', '乘风破浪的姐姐', '披荆斩棘的哥哥', '奔跑吧', '极限挑战',
    '舌尖上的中国', '人生一串', '河西走廊', '地球脉动', '蓝色星球'
];

const Header: React.FC<HeaderProps> = ({ currentView, setView, onBack, onSearch }) => {
  const [searchValue, setSearchValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // 加载搜索历史
  useEffect(() => {
    try {
      const history = localStorage.getItem('streamhub_search_history');
      if (history) {
        setSearchHistory(JSON.parse(history));
      }
    } catch (e) {}
  }, []);

  // 点击外部关闭建议框
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 更新建议列表
  useEffect(() => {
    if (!showSuggestions) return;

    if (!searchValue.trim()) {
      // 没输入时：显示历史记录(最多5条) + 热门搜索
      setSuggestions([...searchHistory.slice(0, 5), ...HOT_SEARCHES].slice(0, 15));
    } else {
      const lowerInput = searchValue.toLowerCase();
      
      // 1. 历史记录匹配 (优先)
      const matchHistory = searchHistory.filter(h => h.toLowerCase().includes(lowerInput));
      
      // 2. 模拟数据库匹配 (模糊匹配)
      // 简单的去重逻辑，防止包含历史记录
      const matchDb = MOCK_DATABASE.filter(item => 
          item.toLowerCase().includes(lowerInput) && !matchHistory.includes(item)
      );

      // 3. 组合结果：输入值本身(可选) -> 匹配的历史 -> 匹配的数据库
      // 限制总数量为 12 条，保证界面不溢出
      const combined = [...matchHistory, ...matchDb];
      
      setSuggestions(Array.from(new Set(combined)).slice(0, 12));
    }
  }, [searchValue, showSuggestions, searchHistory]);

  const saveHistory = (query: string) => {
    const newHistory = [query, ...searchHistory.filter(h => h !== query)].slice(0, 10);
    setSearchHistory(newHistory);
    localStorage.setItem('streamhub_search_history', JSON.stringify(newHistory));
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchValue.trim()) {
      saveHistory(searchValue.trim());
      onSearch(searchValue.trim()); // App.tsx 默认会开启聚合搜索
      setView('SEARCH');
      setShowSuggestions(false);
      // 失焦
      (document.activeElement as HTMLElement)?.blur();
    }
  };

  const handleSuggestionClick = (item: string) => {
    setSearchValue(item);
    saveHistory(item);
    onSearch(item);
    setView('SEARCH');
    setShowSuggestions(false);
  };

  const clearHistory = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSearchHistory([]);
    localStorage.removeItem('streamhub_search_history');
    // 如果当前搜索框为空，清空后刷新建议列表（只剩热词）
    if (!searchValue.trim()) {
        setSuggestions(HOT_SEARCHES.slice(0, 15));
    }
  };

  return (
    <header className="sticky top-0 z-50 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-gray-200 dark:border-gray-700 shadow-sm transition-colors duration-300">
      <div className="max-w-7xl mx-auto px-2 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-2 sm:gap-4">
          
          {/* Logo Section */}
          <div 
            className="flex-shrink-0 flex items-center cursor-pointer group"
            onClick={() => setView('HOME')}
          >
            <div className={`mr-1 sm:mr-2 rounded-lg flex items-center justify-center transition-all duration-300 ${currentView === 'SEARCH' ? 'w-8 h-8 sm:w-10 sm:h-10 bg-blue-600 text-white shadow-lg shadow-blue-500/30' : 'text-blue-600'}`}>
              <Icon 
                name="play_circle_filled" 
                className={currentView === 'SEARCH' ? 'text-xl sm:text-2xl' : 'text-2xl sm:text-3xl'}
                type="round"
              />
            </div>
            <h1 className="text-sm sm:text-xl font-bold tracking-tight text-gray-900 dark:text-white group-hover:text-blue-600 transition-colors whitespace-nowrap">
              StreamHub
              <span className="hidden sm:inline">{currentView === 'HOME' && ' 视界'}</span>
            </h1>
          </div>

          {/* Search Bar Section */}
          <div className="flex-1 max-w-2xl mx-auto px-1 sm:px-0 relative" ref={searchContainerRef}>
            <form onSubmit={handleSearchSubmit} className="relative group">
              <div className="absolute inset-y-0 left-0 pl-2 sm:pl-3 flex items-center pointer-events-none">
                <Icon name="search" className="text-gray-400 group-focus-within:text-blue-500 transition-colors text-lg sm:text-xl" />
              </div>
              <input
                type="text"
                className="block w-full pl-8 sm:pl-10 pr-2 sm:pr-3 py-1.5 sm:py-2 border border-gray-300 dark:border-gray-600 rounded-full leading-5 bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-xs sm:text-sm transition-all duration-300 shadow-inner"
                placeholder="搜索电影、剧集、动漫..."
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                onFocus={() => setShowSuggestions(true)}
              />
              {searchValue && (
                <button 
                    type="button" 
                    onClick={() => setSearchValue('')}
                    className="absolute inset-y-0 right-2 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                    <Icon name="close" className="text-sm" />
                </button>
              )}
            </form>

            {/* Search Suggestions Dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden z-50 animate-fadeIn origin-top">
                 {!searchValue.trim() && searchHistory.length > 0 && (
                     <div className="flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-slate-900/50 text-[10px] text-gray-500 border-b border-gray-100 dark:border-gray-700">
                         <span>历史记录</span>
                         <button onClick={clearHistory} className="hover:text-red-500 flex items-center gap-1"><Icon name="delete" className="text-xs" />清空</button>
                     </div>
                 )}
                 <div className="py-1">
                     {suggestions.map((item, idx) => (
                         <div 
                            key={idx}
                            onClick={() => handleSuggestionClick(item)}
                            className="px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-slate-700 cursor-pointer flex items-center gap-3 text-sm text-gray-700 dark:text-gray-200 transition-colors"
                         >
                            <Icon name={searchHistory.includes(item) ? "history" : "search"} className="text-gray-400 text-base" />
                            <span dangerouslySetInnerHTML={{ __html: item.replace(new RegExp(`(${searchValue})`, 'gi'), '<span class="text-blue-500 font-bold">$1</span>') }}></span>
                         </div>
                     ))}
                 </div>
              </div>
            )}
          </div>

          {/* Actions Section */}
          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            {currentView !== 'HOME' && (
              <button 
                type="button"
                className="flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 rounded-full hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors text-gray-600 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500/50 cursor-pointer"
                onClick={onBack}
                title="返回上一页"
              >
                <Icon name="arrow_back" className="text-lg sm:text-xl" />
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
