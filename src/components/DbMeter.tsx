'use client';

interface Props {
  db: number;
  optimalRange?: [number, number];
}

export default function DbMeter({ db, optimalRange }: Props) {
  const percentage = Math.min(100, (db / 120) * 100);
  const isOptimal = optimalRange && db >= optimalRange[0] && db <= optimalRange[1];

  const getColor = () => {
    if (isOptimal) return 'bg-green-500';
    if (db < 30) return 'bg-blue-400';
    if (db < 60) return 'bg-cyan-400';
    if (db < 80) return 'bg-yellow-400';
    return 'bg-red-400';
  };

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <span className="text-sm text-gray-400">Volume Level</span>
        <span className="text-2xl font-mono font-bold text-white">
          {Math.round(db)} <span className="text-sm text-gray-400">dB</span>
        </span>
      </div>
      <div className="h-4 bg-gray-800 rounded-full overflow-hidden relative">
        {optimalRange && (
          <div
            className="absolute h-full bg-green-500/20 border-x border-green-500/50"
            style={{
              left: `${(optimalRange[0] / 120) * 100}%`,
              width: `${((optimalRange[1] - optimalRange[0]) / 120) * 100}%`,
            }}
          />
        )}
        <div
          className={`h-full rounded-full transition-all duration-150 ${getColor()}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-gray-500">
        <span>Silent</span>
        <span>Moderate</span>
        <span>Loud</span>
      </div>
      {isOptimal && (
        <p className="text-green-400 text-xs text-center">In your optimal zone</p>
      )}
    </div>
  );
}
