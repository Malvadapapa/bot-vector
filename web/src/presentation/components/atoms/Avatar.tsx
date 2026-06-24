import React from 'react';

interface AvatarProps {
  name: string;
  src?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-12 h-12 text-base',
};

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(n => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function getAvatarColor(name: string): string {
  const colors = [
    'from-emerald-500 to-teal-600',
    'from-violet-500 to-purple-600',
    'from-blue-500 to-indigo-600',
    'from-amber-500 to-orange-600',
    'from-rose-500 to-pink-600',
    'from-cyan-500 to-sky-600',
  ];
  const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

export const Avatar: React.FC<AvatarProps> = ({
  name,
  src,
  size = 'md',
  className = '',
}) => {
  const [imgError, setImgError] = React.useState(false);

  if (src && !imgError) {
    return (
      <img
        src={src}
        alt={name}
        onError={() => setImgError(true)}
        className={`
          ${sizeClasses[size]}
          rounded-full object-cover
          border-2 border-[var(--color-border)]
          ${className}
        `}
      />
    );
  }

  return (
    <div
      className={`
        ${sizeClasses[size]}
        rounded-full flex items-center justify-center
        font-semibold text-white
        bg-gradient-to-br ${getAvatarColor(name)}
        border-2 border-[var(--color-border)]
        select-none flex-shrink-0
        ${className}
      `}
      title={name}
    >
      {getInitials(name)}
    </div>
  );
};
