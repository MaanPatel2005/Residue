'use client';

import { useCallback, useEffect, useState } from 'react';
import type { StudyBuddy } from '@/types';

const MOCK_BUDDIES: StudyBuddy[] = [
  {
    id: '1',
    name: 'Alex K.',
    optimalDbRange: [40, 55],
    similarity: 0.92,
    currentlyStudying: true,
    location: 'UCLA Library',
  },
  {
    id: '2',
    name: 'Sarah M.',
    optimalDbRange: [45, 60],
    similarity: 0.87,
    currentlyStudying: true,
    location: 'Starbucks - Westwood',
  },
  {
    id: '3',
    name: 'James R.',
    optimalDbRange: [35, 50],
    similarity: 0.78,
    currentlyStudying: false,
    location: 'Home',
  },
  {
    id: '4',
    name: 'Priya D.',
    optimalDbRange: [50, 65],
    similarity: 0.73,
    currentlyStudying: true,
    location: 'Coffee Bean - Santa Monica',
  },
  {
    id: '5',
    name: 'Mike T.',
    optimalDbRange: [42, 58],
    similarity: 0.69,
    currentlyStudying: false,
    location: 'Dorm Room',
  },
];

interface Props {
  userOptimalRange?: [number, number];
}

export default function StudyBuddyFinder({ userOptimalRange }: Props) {
  const [buddies, setBuddies] = useState<StudyBuddy[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const findBuddies = useCallback(() => {
    setIsSearching(true);
    setTimeout(() => {
      let sorted = [...MOCK_BUDDIES];
      if (userOptimalRange) {
        sorted = sorted.map((b) => {
          const overlap = Math.max(
            0,
            Math.min(b.optimalDbRange[1], userOptimalRange[1]) -
              Math.max(b.optimalDbRange[0], userOptimalRange[0])
          );
          const totalRange = Math.max(
            b.optimalDbRange[1] - b.optimalDbRange[0],
            userOptimalRange[1] - userOptimalRange[0]
          );
          return { ...b, similarity: Math.min(1, overlap / totalRange) };
        });
      }
      sorted.sort((a, b) => b.similarity - a.similarity);
      setBuddies(sorted);
      setIsSearching(false);
    }, 1500);
  }, [userOptimalRange]);

  useEffect(() => {
    const timer = setTimeout(() => {
      findBuddies();
    }, 0);
    return () => clearTimeout(timer);
  }, [findBuddies]);

  return (
    <div className="bg-gray-900/80 backdrop-blur-sm rounded-xl border border-gray-800 p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold text-white">Study Buddy Finder</h3>
        <button
          onClick={findBuddies}
          disabled={isSearching}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition-colors disabled:opacity-50"
        >
          {isSearching ? 'Searching...' : 'Refresh'}
        </button>
      </div>
      <p className="text-xs text-gray-400">
        Find people nearby who study best in similar acoustic environments
        <span className="ml-1 text-purple-400">(Powered by Fetch.ai Agents)</span>
      </p>

      {isSearching ? (
        <div className="flex items-center justify-center py-8">
          <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-2">
          {buddies.map((buddy) => (
            <div
              key={buddy.id}
              className="flex items-center gap-3 p-3 bg-gray-800/50 rounded-lg hover:bg-gray-800/80 transition-colors"
            >
              <div className="relative">
                <div className="w-10 h-10 rounded-full bg-linear-to-br from-purple-500 to-cyan-500 flex items-center justify-center text-white font-bold text-sm">
                  {buddy.name.charAt(0)}
                </div>
                {buddy.currentlyStudying && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-green-500 rounded-full border-2 border-gray-900" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-white">{buddy.name}</p>
                  <span className="text-xs text-cyan-400">
                    {Math.round(buddy.similarity * 100)}% match
                  </span>
                </div>
                <p className="text-xs text-gray-400 truncate">
                  {buddy.location} &middot; Optimal: {buddy.optimalDbRange[0]}-{buddy.optimalDbRange[1]}dB
                </p>
              </div>
              <button className="px-3 py-1.5 rounded-lg text-xs font-medium bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition-colors">
                Connect
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
