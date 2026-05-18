import React, { useMemo, useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { GameSnapshot } from '../lib/types';

interface ScoreGraphProps {
  game: GameSnapshot;
  onClose: () => void;
}

interface DataPoint {
  round: number;
  [key: string]: number | string;
}

export function ScoreGraph({ game, onClose }: ScoreGraphProps) {
  const [chartHeight, setChartHeight] = useState(400);

  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      if (width < 480) {
        setChartHeight(300);
      } else if (width < 768) {
        setChartHeight(320);
      } else {
        setChartHeight(400);
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  const graphData = useMemo(() => {
    const data: DataPoint[] = [];
    const playerScores: Record<string, number> = {};

    // Initialize player scores
    game.players.forEach((player) => {
      playerScores[player.id] = 0;
    });

    // Process each round to accumulate scores
    Object.keys(game.bids)
      .map(Number)
      .sort((a, b) => a - b)
      .forEach((round) => {
        const roundBids = game.bids[round];
        const dataPoint: DataPoint = { round };

        game.players.forEach((player) => {
          const bid = roundBids[player.id];
          if (bid) {
            // Scoring logic: if completed (success) -> bid + 10, otherwise -> 0
            const roundScore = bid.completed ? bid.bid + 10 : 0;
            playerScores[player.id] += roundScore;
          }
          dataPoint[player.id] = playerScores[player.id];
        });

        data.push(dataPoint);
      });

    return data;
  }, [game]);

  const yAxisConfig = useMemo(() => {
    if (graphData.length === 0) {
      return { domain: [0, 100], ticks: [0, 20, 40, 60, 80, 100] };
    }

    // Find maximum score across all players and all rounds
    let maxScore = 0;
    graphData.forEach((dataPoint) => {
      game.players.forEach((player) => {
        const score = dataPoint[player.id] as number | undefined;
        if (typeof score === 'number' && score > maxScore) {
          maxScore = score;
        }
      });
    });

    // Round up to get a nice max value
    const roundedMax = Math.ceil(maxScore / 5) * 5;
    const maxWithBuffer = Math.max(roundedMax, 25); // Minimum range

    // Calculate interval to show ~5 windows
    const interval = Math.ceil(maxWithBuffer / 5 / 5) * 5; // Round to nearest 5
    const ticks = Array.from({ length: 6 }, (_, i) => i * interval).filter((tick) => tick <= maxWithBuffer);

    return {
      domain: [0, maxWithBuffer],
      ticks: ticks.length > 0 ? ticks : [0, maxWithBuffer]
    };
  }, [graphData, game.players]);

  const colors = useMemo(
    () =>
      game.players.reduce(
        (acc, player) => {
          acc[player.id] = player.color;
          return acc;
        },
        {} as Record<string, string>
      ),
    [game.players]
  );

  return (
    <div className="score-graph-overlay">
      <div className="score-graph-backdrop" onClick={onClose} />
      <div className="score-graph-modal">
        <button
          type="button"
          className="score-graph-close"
          onClick={onClose}
          aria-label="Close graph"
          title="Close"
        >
          ✕
        </button>
        <h3>Player Performance Over Rounds</h3>
        <div className="score-graph-container">
          {graphData.length > 0 ? (
            <ResponsiveContainer width="100%" height={chartHeight}>
              <LineChart 
                data={graphData} 
                margin={{ 
                  top: 5, 
                  right: window.innerWidth < 480 ? 10 : 30, 
                  left: window.innerWidth < 480 ? 0 : 0, 
                  bottom: window.innerWidth < 480 ? 20 : 5 
                }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="round"
                  tick={{ fontSize: window.innerWidth < 480 ? 12 : 14 }}
                  label={{ 
                    value: 'Round Number', 
                    position: 'bottom', 
                    offset: window.innerWidth < 480 ? 0 : 0,
                    fontSize: window.innerWidth < 480 ? 12 : 14
                  }}
                />
                <YAxis 
                  tick={{ fontSize: window.innerWidth < 480 ? 12 : 14 }}
                  domain={yAxisConfig.domain}
                  ticks={yAxisConfig.ticks}
                  label={{ 
                    value: 'Total Score', 
                    angle: -90, 
                    position: 'insideLeft',
                    offset: 10,
                    fontSize: window.innerWidth < 480 ? 12 : 14
                  }} 
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    padding: window.innerWidth < 480 ? '6px' : '10px',
                    fontSize: window.innerWidth < 480 ? '12px' : '14px'
                  }}
                  formatter={(value) => {
                    if (typeof value === 'number') {
                      return value.toFixed(0);
                    }
                    return value;
                  }}
                />
                <Legend 
                  wrapperStyle={{
                    paddingTop: window.innerWidth < 480 ? '10px' : '16px',
                    fontSize: window.innerWidth < 480 ? '12px' : '14px'
                  }}
                />
                {game.players.map((player) => (
                  <Line
                    key={player.id}
                    type="monotone"
                    dataKey={player.id}
                    stroke={player.color}
                    name={player.name}
                    strokeWidth={window.innerWidth < 480 ? 1.5 : 2}
                    dot={{ r: window.innerWidth < 480 ? 3 : 4 }}
                    activeDot={{ r: window.innerWidth < 480 ? 5 : 6 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="muted">No data available yet. Start playing rounds to see the graph.</p>
          )}
        </div>
      </div>
    </div>
  );
}
