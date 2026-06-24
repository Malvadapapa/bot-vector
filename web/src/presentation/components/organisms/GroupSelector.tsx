import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { DropdownSelector } from '../molecules/DropdownSelector';
import { Building2 } from 'lucide-react';

export const GroupSelector: React.FC = () => {
  const { activeGroup, groups, setActiveGroup } = useAuth();

  if (groups.length <= 1) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border)] text-sm text-[var(--color-text-secondary)] font-medium">
        <Building2 className="w-4 h-4 text-[var(--color-accent)]" />
        <span>{activeGroup?.name || 'Cargando grupo...'}</span>
      </div>
    );
  }

  const options = groups.map((g) => ({
    value: g.id,
    label: g.name,
    sublabel: g.institutionName,
  }));

  const handleGroupChange = (groupId: string) => {
    const selected = groups.find((g) => g.id === groupId);
    if (selected) {
      setActiveGroup(selected);
    }
  };

  return (
    <div className="w-64">
      <DropdownSelector
        options={options}
        selectedValue={activeGroup?.id || ''}
        onChange={handleGroupChange}
        placeholder="Seleccionar grupo..."
      />
    </div>
  );
};
