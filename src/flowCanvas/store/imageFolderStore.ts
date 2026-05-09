import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { nanoid } from 'nanoid';

export interface FlowImageFolder {
  id: string;
  name: string;
  itemIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface FlowImageFolderItem {
  id: string;
  folderId: string;
  title: string;
  imageUrl: string;
  assetId?: string;
  notes?: string;
  sourceNodeId?: string;
  sourceProjectId?: string;
  sourceProjectTitle?: string;
  originalImageUrl?: string;
  lastEditType?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  createdAt: number;
}

interface ImageFolderState {
  folders: FlowImageFolder[];
  items: FlowImageFolderItem[];
  addFolder: (name: string) => FlowImageFolder;
  addImageToFolder: (
    folderId: string,
    item: Omit<FlowImageFolderItem, 'id' | 'folderId' | 'createdAt'>,
  ) => FlowImageFolderItem;
  getFolderItems: (folderId: string) => FlowImageFolderItem[];
}

const DEFAULT_FOLDER_ID = 'default-flow-images';

const createDefaultFolder = (now = Date.now()): FlowImageFolder => ({
  id: DEFAULT_FOLDER_ID,
  name: '默认素材夹',
  itemIds: [],
  createdAt: now,
  updatedAt: now,
});

const ensureFolders = (folders: FlowImageFolder[]) => {
  if (folders.length > 0) return folders;
  return [createDefaultFolder()];
};

export const useImageFolderStore = create<ImageFolderState>()(
  persist(
    (set, get) => ({
      folders: [createDefaultFolder()],
      items: [],

      addFolder: (name) => {
        const trimmed = name.trim() || '未命名素材夹';
        const now = Date.now();
        const folder: FlowImageFolder = {
          id: nanoid(12),
          name: trimmed,
          itemIds: [],
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({ folders: [...ensureFolders(state.folders), folder] }));
        return folder;
      },

      addImageToFolder: (folderId, item) => {
        const now = Date.now();
        const folders = ensureFolders(get().folders);
        const targetFolder = folders.find((folder) => folder.id === folderId) || folders[0];
        const nextItem: FlowImageFolderItem = {
          ...item,
          id: nanoid(12),
          folderId: targetFolder.id,
          createdAt: now,
        };

        set((state) => ({
          folders: ensureFolders(state.folders).map((folder) =>
            folder.id === targetFolder.id
              ? {
                  ...folder,
                  itemIds: [nextItem.id, ...folder.itemIds],
                  updatedAt: now,
                }
              : folder,
          ),
          items: [nextItem, ...state.items],
        }));

        return nextItem;
      },

      getFolderItems: (folderId) => {
        return get().items.filter((item) => item.folderId === folderId);
      },
    }),
    {
      name: 'flow-image-folders',
      partialize: (state) => ({
        folders: ensureFolders(state.folders),
        items: state.items,
      }),
    },
  ),
);
