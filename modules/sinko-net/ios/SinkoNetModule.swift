// The IPv4 addresses a host name resolves to (getaddrinfo, which asks Bonjour for a .local name and the router's DNS for any other), so
// the app can judge a name by the address behind it (src/api/hosts.ts). An address comes back as it is; a name nobody answers for is [].
import Darwin
import ExpoModulesCore

public final class SinkoNetModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SinkoNet")

    // getaddrinfo blocks (for a .local name nobody answers for, several seconds): on a queue of its own, never the module's.
    AsyncFunction("lookupIpv4") { (host: String, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        promise.resolve(Self.lookupIpv4(host))
      }
    }
  }

  static func lookupIpv4(_ host: String) -> [String] {
    var hints = addrinfo()
    hints.ai_family = AF_INET
    hints.ai_socktype = SOCK_STREAM
    var result: UnsafeMutablePointer<addrinfo>?
    guard getaddrinfo(host, nil, &hints, &result) == 0, let first = result else { return [] }
    defer { freeaddrinfo(first) }
    var out: [String] = []
    var cursor: UnsafeMutablePointer<addrinfo>? = first
    while let info = cursor {
      if info.pointee.ai_family == AF_INET, let sa = info.pointee.ai_addr {
        var addr = sa.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { $0.pointee.sin_addr }
        var buf = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
        if inet_ntop(AF_INET, &addr, &buf, socklen_t(INET_ADDRSTRLEN)) != nil {
          let text = String(cString: buf)
          if !out.contains(text) { out.append(text) }
        }
      }
      cursor = info.pointee.ai_next
    }
    return out
  }
}
