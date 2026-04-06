'use client';

import { useState } from 'react';
import Image from 'next/image';

interface PlayerAvatarProps {
  playerName: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

export default function PlayerAvatar({
  playerName,
  size = 'md',
  className = '',
}: PlayerAvatarProps) {
  const [src, setSrc] = useState(`/player_pics/${playerName}.png`);
  const [hasError, setHasError] = useState(false);

  const sizeClasses = {
    xs: 'w-5 h-5',
    sm: 'w-6 h-6',
    md: 'w-10 h-10',
    lg: 'w-16 h-16',
  };

  return (
    <div className={`relative ${sizeClasses[size]} shrink-0 overflow-hidden rounded-full border border-white/20 bg-white/5 ${className}`}>
      <Image
        src={hasError ? '/player_pics/default.png' : src}
        alt={playerName}
        fill
        className="object-cover transition-opacity duration-300"
        onError={() => {
          if (!hasError) {
            setHasError(true);
          }
        }}
      />
    </div>
  );
}
