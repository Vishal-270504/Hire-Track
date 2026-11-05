import { toast } from 'sonner';

/** Downloads a file from a protected endpoint, using the signed-in session. */
export function useAuthDownload() {
  return async (url, filename) => {
    try {
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'The download did not work.');
      }
      const blob = await res.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
    } catch (e) {
      toast.error(e.message);
    }
  };
}
