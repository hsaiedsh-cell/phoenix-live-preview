'use client';

import React, { useState } from 'react';
import { PlatformSidebar, MobileSidebar } from './PlatformSidebar';
import { PlatformTopbar } from './PlatformTopbar';

interface PlatformShellProps {
  children: React.ReactNode;
  workspaceName: string;
  userName: string;
}

export function PlatformShell({ children, workspaceName, userName }: PlatformShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-phx-surface">
      <PlatformSidebar />
      <MobileSidebar open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />

      <div className="flex-1 min-w-0 flex flex-col">
        <PlatformTopbar
          onOpenMobileNav={() => setMobileNavOpen(true)}
          workspaceName={workspaceName}
          userName={userName}
        />
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-8">
          <div className="max-w-[1400px] mx-auto">{children}</div>
        </main>
      </div>
    </div>
  );
}
