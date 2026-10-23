// The IPv4 addresses a host name resolves to (InetAddress, the system's resolver), so the app can judge a name by the address behind it
// (src/api/hosts.ts). An address comes back as it is; a name nobody answers for is []. Not every Android phone resolves .local names: the
// app finds those boxes by Bonjour or by the scan instead.
package bh.ioai.sinko.net

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.Inet4Address
import java.net.InetAddress
import kotlin.concurrent.thread

class SinkoNetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SinkoNet")

    // The lookup blocks (for a name nobody answers for, several seconds): on a thread of its own, never the module's.
    AsyncFunction("lookupIpv4") { host: String, promise: Promise ->
      thread(name = "SinkoNet.lookup", isDaemon = true) {
        val found = try {
          InetAddress.getAllByName(host).filterIsInstance<Inet4Address>().mapNotNull { it.hostAddress }.distinct()
        } catch (e: Exception) {
          emptyList()
        }
        promise.resolve(found)
      }
    }
  }
}
