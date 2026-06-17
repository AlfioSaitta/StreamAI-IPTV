// This component is temporarily disabled to resolve a build issue.
// A developer will need to fix the react-window import and re-enable it.

import React from 'react';

export const PerformanceProfiler: React.FC = () => {
  return (
    <div className="min-h-screen p-8 text-white bg-black">
      <h1 className="mb-8 text-4xl font-bold">Performance Profiler [Temporarily Disabled]</h1>
      <div className="p-4 mb-8 border-2 border-dashed rounded-lg border-red-400 bg-red-900/50">
        <h2 className="text-xl font-semibold text-red-300">Component Disabled</h2>
        <p className="mt-2 text-red-200">
          This component has been temporarily disabled to fix a persistent build error related to the `react-window` library's module resolution.
          A developer needs to investigate the issue and re-enable the profiler.
        </p>
      </div>
    </div>
  );
};