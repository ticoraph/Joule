import { ReactNode } from "react";
import Sidebar from "./Sidebar";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen bg-gray-50 text-gray-900">
      <Sidebar />
      <div className="flex flex-1 flex-col min-w-0">
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
