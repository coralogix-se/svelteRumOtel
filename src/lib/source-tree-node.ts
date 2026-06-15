/** Shared tree shape for the /source file browser (server walk + SourceTree). */
export type FileNode = {
	name: string;
	path: string;
	children?: FileNode[];
};
