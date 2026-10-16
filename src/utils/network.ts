import os from "os";

/** Best-effort LAN IPv4 address, so QR codes/links work from a student's phone
 *  regardless of what hostname the teacher's own browser happens to be using
 *  (localhost, 127.0.0.1, etc.). Shared by routes/system.ts and routes/courses.ts. */
export function getLocalIp(): string {
  const nets = os.networkInterfaces();
  let fallback: string | null = null;
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family !== "IPv4" || net.internal) continue;
      // 跳過 Tailscale（100.64.0.0/10）、自動私人位址（169.254.x.x）與各種虛擬網卡：
      // 這些位址教室裡的手機／平板連不到，挑到的話 QR Code 會變成無法連線的網址。
      if (isVirtualInterface(name, net.address)) {
        fallback ??= net.address;
        continue;
      }
      return net.address;
    }
  }
  return fallback ?? "127.0.0.1";
}

const VIRTUAL_IFACE_PATTERN = /tailscale|zerotier|vethernet|hyper-v|vmware|virtualbox|vbox|wsl|docker|loopback|npcap|wireguard|openvpn|tap-|tun/i;

function isVirtualInterface(name: string, address: string): boolean {
  if (VIRTUAL_IFACE_PATTERN.test(name)) return true;
  const [a, b] = address.split(".").map(Number);
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT／Tailscale
  if (a === 169 && b === 254) return true; // 自動私人 IP（沒有取得 DHCP）
  return false;
}

/** Every non-internal IPv4 address across all network interfaces (not just the
 *  first one), used by src/tls.ts to build a self-signed cert's SAN list so it
 *  stays valid regardless of which interface a device ends up routed through. */
export function getAllLocalIps(): string[] {
  const nets = os.networkInterfaces();
  const ips: string[] = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips;
}
