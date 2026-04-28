export type SidebarTab = 'quizzes' | 'notes' | 'chat';

export const SIDEBAR_TABS: SidebarTab[] = ['quizzes', 'notes', 'chat'];

export const SIDEBAR_TAB_STORAGE_KEY = 'scrolllearn:sidebar:tab';

export function isSidebarTab(value: unknown): value is SidebarTab {
  return value === 'quizzes' || value === 'notes' || value === 'chat';
}
