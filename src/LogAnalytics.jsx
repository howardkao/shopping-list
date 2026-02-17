import React, { useState, useEffect } from 'react';
import { X, Download, RefreshCw, AlertTriangle, Users, Activity, Wifi, Lock } from 'lucide-react';
import { ref, get } from 'firebase/database';
import { database } from './firebase';

function StatCard({ icon: Icon, title, value, subtitle, color = 'blue' }) {
  const colors = {
    blue: 'bg-blue-100 text-blue-600',
    red: 'bg-red-100 text-red-600',
    yellow: 'bg-yellow-100 text-yellow-600',
    green: 'bg-green-100 text-green-600'
  };

  return (
    <div className="bg-white rounded-xl border-2 border-gray-200 p-4">
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-lg ${colors[color]}`}>
          <Icon size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-2xl font-bold text-gray-800">{value}</div>
          <div className="text-sm font-semibold text-gray-600">{title}</div>
          {subtitle && <div className="text-xs text-gray-500 mt-1">{subtitle}</div>}
        </div>
      </div>
    </div>
  );
}

function IssueCard({ issue, onClick }) {
  const severity = issue.level === 'error' ? 'red' : 'yellow';
  const severityColors = {
    red: 'bg-red-50 border-red-200 text-red-700',
    yellow: 'bg-yellow-50 border-yellow-200 text-yellow-700'
  };

  return (
    <div
      onClick={onClick}
      className={`${severityColors[severity]} rounded-lg border-2 p-3 cursor-pointer hover:shadow-md transition-shadow`}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold">{issue.category}: {issue.message}</div>
          <div className="text-xs mt-1 opacity-80">
            {issue.count} occurrence{issue.count > 1 ? 's' : ''} • {issue.affectedUsers} user{issue.affectedUsers > 1 ? 's' : ''}
          </div>
          <div className="text-xs mt-1 opacity-60">
            Last seen: {new Date(issue.lastSeen).toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LogAnalytics({ onClose }) {
  const [loading, setLoading] = useState(true);
  const [allLogs, setAllLogs] = useState([]);
  const [stats, setStats] = useState({
    totalLogs: 0,
    totalUsers: 0,
    totalErrors: 0,
    totalWarnings: 0,
    authIssues: 0,
    networkIssues: 0,
    syncIssues: 0
  });
  const [commonIssues, setCommonIssues] = useState([]);
  const [recentErrors, setRecentErrors] = useState([]);
  const [dateRange, setDateRange] = useState('7');

  useEffect(() => {
    loadAllLogs();
  }, [dateRange]);

  const loadAllLogs = async () => {
    setLoading(true);
    try {
      const logsRef = ref(database, 'logs');
      const snapshot = await get(logsRef);

      if (!snapshot.exists()) {
        setLoading(false);
        return;
      }

      const allUsersLogs = snapshot.val();
      const logs = [];
      const days = parseInt(dateRange);
      const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);

      // Collect all logs from all users
      for (const [userId, userSessions] of Object.entries(allUsersLogs)) {
        for (const [sessionId, sessionLogs] of Object.entries(userSessions)) {
          for (const [logId, log] of Object.entries(sessionLogs || {})) {
            if (log.timestamp >= cutoffTime) {
              logs.push({
                ...log,
                userId,
                sessionId,
                logId
              });
            }
          }
        }
      }

      // Sort by timestamp (newest first)
      logs.sort((a, b) => b.timestamp - a.timestamp);

      setAllLogs(logs);
      analyzeeLogs(logs);
    } catch (error) {
      console.error('Failed to load logs:', error);
    }
    setLoading(false);
  };

  const analyzeeLogs = (logs) => {
    const uniqueUsers = new Set(logs.map(l => l.userId));
    const errors = logs.filter(l => l.level === 'error');
    const warnings = logs.filter(l => l.level === 'warn');

    const authIssues = logs.filter(l =>
      l.category === 'Auth' && (l.level === 'error' || l.level === 'warn')
    );

    const networkIssues = logs.filter(l =>
      l.category === 'Network' && (l.level === 'error' || l.level === 'warn')
    );

    const syncIssues = logs.filter(l =>
      (l.category === 'Sync' || l.category === 'Firebase') &&
      (l.level === 'error' || l.level === 'warn')
    );

    setStats({
      totalLogs: logs.length,
      totalUsers: uniqueUsers.size,
      totalErrors: errors.length,
      totalWarnings: warnings.length,
      authIssues: authIssues.length,
      networkIssues: networkIssues.length,
      syncIssues: syncIssues.length
    });

    // Find common issues (group by category + message)
    const issueGroups = {};

    logs.filter(l => l.level === 'error' || l.level === 'warn').forEach(log => {
      const key = `${log.category}:${log.message}`;
      if (!issueGroups[key]) {
        issueGroups[key] = {
          category: log.category,
          message: log.message,
          level: log.level,
          count: 0,
          affectedUsers: new Set(),
          lastSeen: log.timestamp,
          examples: []
        };
      }
      issueGroups[key].count++;
      issueGroups[key].affectedUsers.add(log.userId);
      issueGroups[key].lastSeen = Math.max(issueGroups[key].lastSeen, log.timestamp);
      if (issueGroups[key].examples.length < 3) {
        issueGroups[key].examples.push(log);
      }
    });

    // Convert to array and sort by count
    const issues = Object.values(issueGroups).map(issue => ({
      ...issue,
      affectedUsers: issue.affectedUsers.size
    })).sort((a, b) => b.count - a.count);

    setCommonIssues(issues.slice(0, 10));
    setRecentErrors(errors.slice(0, 20));
  };

  const exportAnalysis = () => {
    const analysis = {
      generatedAt: new Date().toISOString(),
      dateRange: `Last ${dateRange} days`,
      stats,
      commonIssues: commonIssues.map(issue => ({
        ...issue,
        examples: issue.examples.map(ex => ({
          timestamp: new Date(ex.timestamp).toISOString(),
          userId: ex.userId,
          data: ex.data
        }))
      })),
      recentErrors: recentErrors.slice(0, 50)
    };

    const blob = new Blob([JSON.stringify(analysis, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `log-analysis-${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-[9999]">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-7xl h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-gradient-to-r from-blue-50 to-purple-50">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">Log Analytics</h2>
            <p className="text-sm text-gray-600 mt-1">
              Aggregated insights from all users' logs
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-gray-400"
            >
              <option value="1">Last 24 hours</option>
              <option value="7">Last 7 days</option>
              <option value="14">Last 14 days</option>
              <option value="30">Last 30 days</option>
            </select>
            <button
              onClick={loadAllLogs}
              disabled={loading}
              className="p-2 hover:bg-white/50 rounded-lg transition-colors"
              title="Refresh"
            >
              <RefreshCw size={20} className={`text-gray-600 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={exportAnalysis}
              className="p-2 hover:bg-white/50 rounded-lg transition-colors"
              title="Export analysis"
            >
              <Download size={20} className="text-gray-600" />
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/50 rounded-lg transition-colors"
            >
              <X size={20} className="text-gray-600" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-gray-500">Analyzing logs...</div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6">
            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <StatCard
                icon={Activity}
                title="Total Events"
                value={stats.totalLogs.toLocaleString()}
                subtitle={`Last ${dateRange} days`}
                color="blue"
              />
              <StatCard
                icon={Users}
                title="Active Users"
                value={stats.totalUsers}
                subtitle="With logged events"
                color="green"
              />
              <StatCard
                icon={AlertTriangle}
                title="Errors"
                value={stats.totalErrors}
                subtitle={`${stats.totalWarnings} warnings`}
                color="red"
              />
              <StatCard
                icon={Lock}
                title="Auth Issues"
                value={stats.authIssues}
                subtitle={`${stats.networkIssues} network, ${stats.syncIssues} sync`}
                color="yellow"
              />
            </div>

            {/* Common Issues */}
            <div className="mb-6">
              <h3 className="text-lg font-bold text-gray-800 mb-3 flex items-center gap-2">
                <AlertTriangle size={20} className="text-red-600" />
                Common Issues
              </h3>
              {commonIssues.length === 0 ? (
                <div className="bg-green-50 border-2 border-green-200 rounded-lg p-4 text-center text-green-700">
                  No recurring issues found! 🎉
                </div>
              ) : (
                <div className="space-y-2">
                  {commonIssues.map((issue, idx) => (
                    <IssueCard
                      key={idx}
                      issue={issue}
                      onClick={() => {
                        console.log('Issue details:', issue);
                        alert(`Issue: ${issue.category} - ${issue.message}\n\nOccurrences: ${issue.count}\nUsers affected: ${issue.affectedUsers}\n\nSee console for full details.`);
                      }}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Recent Errors */}
            <div>
              <h3 className="text-lg font-bold text-gray-800 mb-3">Recent Errors</h3>
              {recentErrors.length === 0 ? (
                <div className="bg-gray-50 border-2 border-gray-200 rounded-lg p-4 text-center text-gray-600">
                  No errors in selected time range
                </div>
              ) : (
                <div className="bg-white border-2 border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-gray-700">Time</th>
                        <th className="px-3 py-2 text-left font-semibold text-gray-700">Category</th>
                        <th className="px-3 py-2 text-left font-semibold text-gray-700">Message</th>
                        <th className="px-3 py-2 text-left font-semibold text-gray-700">User</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentErrors.slice(0, 10).map((error, idx) => (
                        <tr
                          key={idx}
                          className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                          onClick={() => {
                            console.log('Error details:', error);
                            alert(`Error: ${error.message}\n\nSee console for full details including data.`);
                          }}
                        >
                          <td className="px-3 py-2 text-gray-600 font-mono text-xs">
                            {new Date(error.timestamp).toLocaleString()}
                          </td>
                          <td className="px-3 py-2">
                            <span className="inline-block px-2 py-1 bg-red-100 text-red-700 rounded font-medium text-xs">
                              {error.category}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-gray-800">{error.message}</td>
                          <td className="px-3 py-2 text-gray-600 font-mono text-xs">
                            {error.userId.slice(0, 8)}...
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="p-3 border-t border-gray-200 bg-gray-50 text-xs text-gray-600">
          <div className="flex items-center justify-between">
            <div>
              Logs sync automatically every minute • Click on issues for details
            </div>
            <div>
              Total logs analyzed: {allLogs.length.toLocaleString()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
