import { beforeEach, describe, expect, it } from 'vitest';
import { useImageFolderStore, type FlowImageFolder } from './imageFolderStore';

const defaultFolder = (): FlowImageFolder => ({
  id: 'default-flow-images',
  name: '默认素材夹',
  itemIds: [],
  createdAt: 1,
  updatedAt: 1,
});

describe('imageFolderStore', () => {
  beforeEach(() => {
    localStorage.removeItem('flow-image-folders');
    useImageFolderStore.setState({
      folders: [defaultFolder()],
      items: [],
    });
  });

  it('adds folders and selects a stable fallback name', () => {
    const store = useImageFolderStore.getState();

    const folder = store.addFolder('  ');

    expect(folder.name).toBe('未命名素材夹');
    expect(useImageFolderStore.getState().folders).toHaveLength(2);
  });

  it('adds images to the selected folder and updates item counts', () => {
    const store = useImageFolderStore.getState();
    const folder = store.addFolder('产品图');

    const item = useImageFolderStore.getState().addImageToFolder(folder.id, {
      title: '测试图片',
      imageUrl: 'data:image/png;base64,abc',
      sourceNodeId: 'node-1',
      naturalWidth: 512,
      naturalHeight: 512,
    });

    const nextState = useImageFolderStore.getState();
    const nextFolder = nextState.folders.find((entry) => entry.id === folder.id);
    expect(item.folderId).toBe(folder.id);
    expect(nextFolder?.itemIds).toContain(item.id);
    expect(nextState.getFolderItems(folder.id)).toHaveLength(1);
  });
});
