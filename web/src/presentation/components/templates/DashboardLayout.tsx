import React, { useState } from 'react';
import { Sidebar } from '../organisms/Sidebar';
import { Header } from '../organisms/Header';
import { ABPWarningBanner } from '../organisms/ABPWarningBanner';
import { Menu, X } from 'lucide-react';

interface DashboardLayoutProps {
  children: React.ReactNode;
  title: string;
}

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({ children, title }) => {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <div className="flex h-dvh w-screen overflow-hidden bg-[var(--color-bg-app)] text-[var(--color-text-primary)]">
      {/* Desktop Sidebar (visible on md+) */}
      <Sidebar className="hidden md:flex flex-shrink-0" />

      {/* Mobile Sidebar Overlay Drawer */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
            onClick={() => setMobileSidebarOpen(false)}
          />
          {/* Sidebar container */}
          <div className="fixed inset-y-0 left-0 w-64 bg-[var(--color-bg-sidebar)] shadow-2xl flex flex-col z-50 animate-fade-in">
            <Sidebar className="w-full h-full" onClose={() => setMobileSidebarOpen(false)} />
          </div>
        </div>
      )}

      {/* Main content body */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Header container */}
        <div className="w-full sticky top-0 z-30 flex-shrink-0">
          <Header title={title} onMenuClick={() => setMobileSidebarOpen(true)} />
        </div>

        {/* Fixed warning banner at the top of content area */}
        <ABPWarningBanner />

        {/* Scrollable sub-screen contents */}
        <main className="flex-1 overflow-y-auto px-4 py-6 md:p-8">
          <div className="max-w-7xl mx-auto space-y-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
};
export default DashboardLayout;
