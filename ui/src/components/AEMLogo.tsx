interface HCPLogoProps {
  height?: number;
  className?: string;
  mono?: boolean;
  showText?: boolean;
}

/*
 * Network graph inside an octagon — nodes connected by edges,
 * inspired by the Brandmark reference icon.
 */
export function AEMLogo({ height = 22, className = '', mono = false, showText = false }: HCPLogoProps) {
  const color = mono ? 'currentColor' : '#c4a55a';
  const w = height;

  // Octagon vertices (r=46, center 50,50)
  const oct = [
    [50, 4], [82.5, 17.5], [96, 50], [82.5, 82.5],
    [50, 96], [17.5, 82.5], [4, 50], [17.5, 17.5],
  ];
  const octPath = oct.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]},${p[1]}`).join(' ') + ' Z';

  // Inner pentagon nodes (r=30, center 50,50, rotated -90° so top vertex points up)
  const inner = Array.from({ length: 5 }, (_, i) => {
    const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
    return [+(50 + 30 * Math.cos(a)).toFixed(1), +(50 + 30 * Math.sin(a)).toFixed(1)] as [number, number];
  });

  // Edges: center to each inner, each inner to next, each inner to octagon
  const cx = 50, cy = 50;

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 100 100"
        width={w}
        height={w}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Octagon */}
        <path d={octPath} />

        {/* Spokes: center → inner nodes */}
        {inner.map((p, i) => (
          <line key={`spoke-${i}`} x1={cx} y1={cy} x2={p[0]} y2={p[1]} />
        ))}

        {/* Pentagon edges: inner node → next inner node */}
        {inner.map((p, i) => {
          const next = inner[(i + 1) % 5];
          return <line key={`pent-${i}`} x1={p[0]} y1={p[1]} x2={next[0]} y2={next[1]} />;
        })}

        {/* Bridges: inner nodes → nearest octagon vertices */}
        {inner.map((p, i) => {
          // Map each inner node to two nearest octagon vertices
          const octIdx1 = Math.round((i * 8) / 5) % 8;
          const octIdx2 = (octIdx1 + 1) % 8;
          return (
            <g key={`bridge-${i}`}>
              <line x1={p[0]} y1={p[1]} x2={oct[octIdx1][0]} y2={oct[octIdx1][1]} />
              <line x1={p[0]} y1={p[1]} x2={oct[octIdx2][0]} y2={oct[octIdx2][1]} />
            </g>
          );
        })}

        {/* Node dots */}
        <circle cx={cx} cy={cy} r="5" fill={color} stroke="none" />
        {inner.map((p, i) => (
          <circle key={`dot-${i}`} cx={p[0]} cy={p[1]} r="3.5" fill={color} stroke="none" />
        ))}
      </svg>
      {showText && (
        <span className="text-[11px] text-muted whitespace-nowrap">Harness Control Plane</span>
      )}
    </div>
  );
}
