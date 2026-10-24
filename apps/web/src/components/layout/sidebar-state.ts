import { cookies } from 'next/headers';

// The shadcn SidebarProvider remembers open/collapsed in this cookie; read it
// in the server layout so a collapsed sidebar doesn't flash open on load.
export async function sidebarDefaultOpen() {
  const cookieStore = await cookies();
  return cookieStore.get('sidebar_state')?.value !== 'false';
}
