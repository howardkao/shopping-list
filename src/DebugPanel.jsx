import React, { useState, useEffect, useRef } from 'react';
import { X, Download, Trash2, Search, Filter } from 'lucide-react';
import { logger } from './logger';

const LEVEL_COLORS = {
  debug: '#999999',
  info: '#0066cc',
  warn: '#ff9900',
  error: '#cc0000'
};

const LEVEL_LABELS = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR'
};

function LogEntry({ log, index }) {
  const [expanded, setExpanded] = useState(false);

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3
    });
  };

  return (
    <div
      className="border-b border-gray-200 hover:bg-gray-50 transition-colors"
      style={{ fontSize: '11px', fontFamily: 'monospace' }}
    >
      <div
        className="px-3 py-2 cursor-pointer flex items-start gap-2"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-gray-500 flex-shrink-0" style={{ minWidth: '80px' }}>
          {formatTime(log.timestamp)}
        </span>
        <span
          className="font-bold flex-shrink-0"
          style={{ color: LEVEL_COLORS[log.level], minWidth: '50px' }}
        >
          {LEVEL_LABELS[log.level]}
        </span>
        <span className="text-blue-700 flex-shrink-0" style={{ minWidth: '100px' }}>
          [{log.category}]
        </span>
        <span className="flex-1 text-gray-800">{log.message}</span>
      </div>
      {expanded && (
        <div className="px-3 pb-2 bg-gray-100">
          <pre className="text-xs overflow-x-auto p-2 bg-white rounded border border-gray-300">
            {JSON.stringify(log.data, null, 2)}
          </pre>
          <div className="text-xs text-gray-500 mt-1">
            Session: {log.sessionId}
          </div>
        </div>
      )}
    </div>
  );
}

export default function DebugPanel({ onClose }) {
  const [logs, setLogs] = useState([]);
  const [filterLevel, setFilterLevel] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const logsEndRef = useRef(null);
  const logsContainerRef = useRef(null);

  useEffect(() => {
    // Load initial logs from buffer
    setLogs(logger.getBufferedLogs());

    // Subscribe to new logs
    const unsubscribe = logger.subscribe((newLog) => {
      setLogs(prev => [...prev, newLog]);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const handleScroll = () => {
    if (!logsContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logsContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  };

  const categories = ['all', ...new Set(logs.map(log => log.category))];

  const filteredLogs = logs.filter(log => {
    if (filterLevel !== 'all' && log.level !== filterLevel) return false;
    if (filterCategory !== 'all' && log.category !== filterCategory) return false;
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      return (
        log.message.toLowerCase().includes(search) ||
        log.category.toLowerCase().includes(search) ||
        JSON.stringify(log.data).toLowerCase().includes(search)
      );
    }
    return true;
  });

  const handleExport = () => {
    logger.exportLogs();
  };

  const handleClear = () => {
    if (confirm('Clear all logs from memory? (This will not delete logs from IndexedDB or Firebase)')) {
      setLogs([]);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-[9999]">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
          <div>
            <h2 className="text-xl font-bold text-gray-800">Debug Panel</h2>
            <p className="text-xs text-gray-600 mt-1">
              Session: {logger.getSessionId()} | {filteredLogs.length} logs
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExport}
              className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
              title="Export logs as JSON"
            >
              <Download size={20} className="text-gray-600" />
            </button>
            <button
              onClick={handleClear}
              className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
              title="Clear logs from memory"
            >
              <Trash2 size={20} className="text-gray-600" />
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
            >
              <X size={20} className="text-gray-600" />
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="p-4 border-b border-gray-200 flex flex-wrap gap-3 bg-gray-50">
          <div className="flex items-center gap-2">
            <Filter size={16} className="text-gray-500" />
            <select
              value={filterLevel}
              onChange={(e) => setFilterLevel(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-gray-400"
            >
              <option value="all">All Levels</option>
              <option value="debug">Debug</option>
              <option value="info">Info</option>
              <option value="warn">Warn</option>
              <option value="error">Error</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-gray-400"
            >
              {categories.map(cat => (
                <option key={cat} value={cat}>
                  {cat === 'all' ? 'All Categories' : cat}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 flex items-center gap-2">
            <Search size={16} className="text-gray-500" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search logs..."
              className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-gray-400"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded"
            />
            Auto-scroll
          </label>
        </div>

        {/* Logs */}
        <div
          ref={logsContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto bg-white"
        >
          {filteredLogs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-500">
              No logs to display
            </div>
          ) : (
            <>
              {filteredLogs.map((log, index) => (
                <LogEntry key={index} log={log} index={index} />
              ))}
              <div ref={logsEndRef} />
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-gray-200 bg-gray-50 text-xs text-gray-600">
          <div className="flex items-center justify-between">
            <div>
              Logs are stored in IndexedDB and Firebase for remote access
            </div>
            <div className="flex items-center gap-4">
              <span className={`flex items-center gap-1 ${autoScroll ? 'text-green-600' : 'text-gray-400'}`}>
                {autoScroll ? '● Auto-scrolling' : '○ Manual scroll'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
