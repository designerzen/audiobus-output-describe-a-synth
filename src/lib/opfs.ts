export type StoredSampleMetadata = {
  slot: number;
  prompt: string;
  variant: string;
  createdAt: string;
  duration: number;
  fileName: string;
};

export type StoredSample = StoredSampleMetadata & {
  blob: Blob;
};

type SoundboardManifest = {
  version: 1;
  samples: StoredSampleMetadata[];
};

const DIRECTORY_NAME = "prompt-soundboard";
const MANIFEST_NAME = "manifest.json";

type StorageManagerWithDirectory = StorageManager & {
  getDirectory(): Promise<FileSystemDirectoryHandle>;
};

function storageManager(): StorageManagerWithDirectory {
  if (!navigator.storage || !("getDirectory" in navigator.storage)) {
    throw new Error(
      "Origin Private File System is not supported in this browser.",
    );
  }

  return navigator.storage as StorageManagerWithDirectory;
}

async function appDirectory(): Promise<FileSystemDirectoryHandle> {
  const root = await storageManager().getDirectory();
  return root.getDirectoryHandle(DIRECTORY_NAME, { create: true });
}

async function readManifest(
  directory: FileSystemDirectoryHandle,
): Promise<SoundboardManifest> {
  try {
    const handle = await directory.getFileHandle(MANIFEST_NAME);
    const file = await handle.getFile();
    const parsed = JSON.parse(await file.text()) as SoundboardManifest;

    if (parsed.version !== 1 || !Array.isArray(parsed.samples)) {
      throw new Error("Unsupported soundboard manifest.");
    }

    return parsed;
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") {
      return { version: 1, samples: [] };
    }
    throw error;
  }
}

async function writeManifest(
  directory: FileSystemDirectoryHandle,
  manifest: SoundboardManifest,
): Promise<void> {
  const handle = await directory.getFileHandle(MANIFEST_NAME, {
    create: true,
  });
  const writable = await handle.createWritable();
  await writable.write(
    new Blob([JSON.stringify(manifest, null, 2)], {
      type: "application/json",
    }),
  );
  await writable.close();
}

export function supportsOpfs(): boolean {
  return Boolean(
    navigator.storage && "getDirectory" in navigator.storage,
  );
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
}

export async function loadSamples(): Promise<StoredSample[]> {
  const directory = await appDirectory();
  const manifest = await readManifest(directory);
  const samples: StoredSample[] = [];

  for (const metadata of manifest.samples) {
    try {
      const handle = await directory.getFileHandle(metadata.fileName);
      const file = await handle.getFile();
      samples.push({
        ...metadata,
        blob: new Blob([file], { type: "audio/wav" }),
      });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "NotFoundError")) {
        throw error;
      }
    }
  }

  return samples;
}

export async function saveSample(
  metadata: Omit<StoredSampleMetadata, "fileName">,
  blob: Blob,
): Promise<StoredSampleMetadata> {
  const directory = await appDirectory();
  const fileName = `slot-${metadata.slot}.wav`;
  const fileHandle = await directory.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();

  const storedMetadata = { ...metadata, fileName };
  const manifest = await readManifest(directory);
  manifest.samples = [
    ...manifest.samples.filter((sample) => sample.slot !== metadata.slot),
    storedMetadata,
  ].sort((a, b) => a.slot - b.slot);
  await writeManifest(directory, manifest);

  return storedMetadata;
}

export async function deleteSample(slot: number): Promise<void> {
  const directory = await appDirectory();
  const manifest = await readManifest(directory);
  const sample = manifest.samples.find((item) => item.slot === slot);

  if (sample) {
    try {
      await directory.removeEntry(sample.fileName);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "NotFoundError")) {
        throw error;
      }
    }
  }

  manifest.samples = manifest.samples.filter((item) => item.slot !== slot);
  await writeManifest(directory, manifest);
}
