#include "linux_wayland_primary.h"

#include <fcntl.h>
#include <poll.h>
#include <unistd.h>

#include <wayland-client.h>

#include <chrono>
#include <cstring>
#include <string>
#include <vector>

#include "wayland/ext-data-control-v1-client.h"
#include "wayland/wlr-data-control-unstable-v1-client.h"

namespace phevere {

namespace {

constexpr size_t kMaxBytes = 8000;
constexpr int kReceiveTimeoutMs = 400;

// The two protocols are the same shape; traits pick the generated functions.
struct ExtTraits {
  using Manager = ext_data_control_manager_v1;
  using Device = ext_data_control_device_v1;
  using Offer = ext_data_control_offer_v1;
  using DeviceListener = ext_data_control_device_v1_listener;
  using OfferListener = ext_data_control_offer_v1_listener;
  static const wl_interface* managerInterface() { return &ext_data_control_manager_v1_interface; }
  static constexpr uint32_t kVersion = 1;
  static Device* getDevice(Manager* m, wl_seat* s) { return ext_data_control_manager_v1_get_data_device(m, s); }
  static int addDeviceListener(Device* d, const DeviceListener* l, void* data) {
    return ext_data_control_device_v1_add_listener(d, l, data);
  }
  static int addOfferListener(Offer* o, const OfferListener* l, void* data) {
    return ext_data_control_offer_v1_add_listener(o, l, data);
  }
  static void receive(Offer* o, const char* mime, int fd) { ext_data_control_offer_v1_receive(o, mime, fd); }
  static void destroyOffer(Offer* o) { ext_data_control_offer_v1_destroy(o); }
  static void destroyDevice(Device* d) { ext_data_control_device_v1_destroy(d); }
  static void destroyManager(Manager* m) { ext_data_control_manager_v1_destroy(m); }
  static void* offerData(Offer* o) { return ext_data_control_offer_v1_get_user_data(o); }
  static const char* name() { return "ext-data-control-v1"; }
};

struct WlrTraits {
  using Manager = zwlr_data_control_manager_v1;
  using Device = zwlr_data_control_device_v1;
  using Offer = zwlr_data_control_offer_v1;
  using DeviceListener = zwlr_data_control_device_v1_listener;
  using OfferListener = zwlr_data_control_offer_v1_listener;
  static const wl_interface* managerInterface() { return &zwlr_data_control_manager_v1_interface; }
  static constexpr uint32_t kVersion = 2;  // primary_selection arrived in v2
  static Device* getDevice(Manager* m, wl_seat* s) { return zwlr_data_control_manager_v1_get_data_device(m, s); }
  static int addDeviceListener(Device* d, const DeviceListener* l, void* data) {
    return zwlr_data_control_device_v1_add_listener(d, l, data);
  }
  static int addOfferListener(Offer* o, const OfferListener* l, void* data) {
    return zwlr_data_control_offer_v1_add_listener(o, l, data);
  }
  static void receive(Offer* o, const char* mime, int fd) { zwlr_data_control_offer_v1_receive(o, mime, fd); }
  static void destroyOffer(Offer* o) { zwlr_data_control_offer_v1_destroy(o); }
  static void destroyDevice(Device* d) { zwlr_data_control_device_v1_destroy(d); }
  static void destroyManager(Manager* m) { zwlr_data_control_manager_v1_destroy(m); }
  static void* offerData(Offer* o) { return zwlr_data_control_offer_v1_get_user_data(o); }
  static const char* name() { return "wlr-data-control-unstable-v1"; }
};

struct OfferMimes {
  std::vector<std::string> mimes;
};

const char* pickMime(const OfferMimes* m) {
  if (!m) return nullptr;
  static const char* kPreferred[] = {"text/plain;charset=utf-8", "UTF8_STRING", "text/plain", "STRING", "TEXT"};
  for (const char* want : kPreferred) {
    for (const auto& have : m->mimes) {
      if (have == want) return want;
    }
  }
  return nullptr;
}

}  // namespace

struct WaylandPrimaryWatcher::Impl {
  wl_display* display = nullptr;
  wl_registry* registry = nullptr;
  wl_seat* seat = nullptr;
  ext_data_control_manager_v1* extManager = nullptr;
  zwlr_data_control_manager_v1* wlrManager = nullptr;
  void* device = nullptr;
  bool useExt = false;
  bool finished = false;
  bool reading = false;

  // Latest primary offer, read during dispatch (outside the listener).
  void* pendingOffer = nullptr;
  bool pendingChange = false;
  void* currentOffer = nullptr;

  template <typename T>
  static void onOfferMime(void* data, typename T::Offer*, const char* mime) {
    auto* m = static_cast<OfferMimes*>(data);
    if (m && mime) m->mimes.emplace_back(mime);
  }

  template <typename T>
  static void freeOffer(typename T::Offer* offer) {
    if (!offer) return;
    delete static_cast<OfferMimes*>(T::offerData(offer));
    T::destroyOffer(offer);
  }

  template <typename T>
  static void onDataOffer(void*, typename T::Device*, typename T::Offer* offer) {
    static const typename T::OfferListener listener = {&Impl::onOfferMime<T>};
    T::addOfferListener(offer, &listener, new OfferMimes());
  }

  template <typename T>
  static void onSelection(void*, typename T::Device*, typename T::Offer* offer) {
    // Clipboard (CLIPBOARD); not ours to read.
    freeOffer<T>(offer);
  }

  template <typename T>
  static void onPrimary(void* data, typename T::Device*, typename T::Offer* offer) {
    auto* self = static_cast<Impl*>(data);
    if (self->pendingOffer && self->pendingOffer != offer) {
      freeOffer<T>(static_cast<typename T::Offer*>(self->pendingOffer));
    }
    self->pendingOffer = offer;
    self->pendingChange = true;
  }

  template <typename T>
  static void onFinished(void* data, typename T::Device*) {
    static_cast<Impl*>(data)->finished = true;
  }

  template <typename T>
  void bindDevice() {
    static const typename T::DeviceListener listener = {
        &Impl::onDataOffer<T>, &Impl::onSelection<T>, &Impl::onFinished<T>, &Impl::onPrimary<T>};
    auto* manager = useExt ? static_cast<void*>(extManager) : static_cast<void*>(wlrManager);
    auto* dev = T::getDevice(static_cast<typename T::Manager*>(manager), seat);
    T::addDeviceListener(dev, &listener, this);
    device = dev;
  }

  template <typename T>
  bool readOffer(void* rawOffer, std::string* out) {
    auto* offer = static_cast<typename T::Offer*>(rawOffer);
    out->clear();
    const char* mime = pickMime(static_cast<OfferMimes*>(T::offerData(offer)));
    if (!mime) return false;
    int fds[2];
    if (pipe2(fds, O_CLOEXEC) != 0) return false;
    T::receive(offer, mime, fds[1]);
    wl_display_flush(display);
    ::close(fds[1]);
    const auto started = std::chrono::steady_clock::now();
    char buf[1024];
    bool ok = true;
    while (true) {
      const int elapsed = static_cast<int>(std::chrono::duration_cast<std::chrono::milliseconds>(
                                               std::chrono::steady_clock::now() - started)
                                               .count());
      if (elapsed >= kReceiveTimeoutMs) {
        ok = false;
        break;
      }
      struct pollfd pfd = {fds[0], POLLIN, 0};
      if (poll(&pfd, 1, kReceiveTimeoutMs - elapsed) <= 0) {
        ok = false;
        break;
      }
      const ssize_t n = ::read(fds[0], buf, sizeof buf);
      if (n <= 0) break;
      out->append(buf, static_cast<size_t>(n));
      if (out->size() > kMaxBytes) {
        ok = false;  // longer than any lookup we keep
        break;
      }
    }
    ::close(fds[0]);
    return ok;
  }

  template <typename T>
  void deliver(const TextFn& onChange) {
    if (!pendingChange) return;
    pendingChange = false;
    void* offer = pendingOffer;
    pendingOffer = nullptr;
    if (currentOffer) freeOffer<T>(static_cast<typename T::Offer*>(currentOffer));
    currentOffer = offer;
    std::string text;
    if (offer) readOffer<T>(offer, &text);
    onChange(text);
  }

  template <typename T>
  void teardown() {
    if (pendingOffer) freeOffer<T>(static_cast<typename T::Offer*>(pendingOffer));
    if (currentOffer && currentOffer != pendingOffer) freeOffer<T>(static_cast<typename T::Offer*>(currentOffer));
    pendingOffer = currentOffer = nullptr;
    if (device) T::destroyDevice(static_cast<typename T::Device*>(device));
    device = nullptr;
  }

  static void onGlobal(void* data, wl_registry* reg, uint32_t name, const char* iface, uint32_t version) {
    auto* self = static_cast<Impl*>(data);
    if (std::strcmp(iface, wl_seat_interface.name) == 0 && !self->seat) {
      self->seat = static_cast<wl_seat*>(wl_registry_bind(reg, name, &wl_seat_interface, 1));
    } else if (std::strcmp(iface, ext_data_control_manager_v1_interface.name) == 0) {
      self->extManager = static_cast<ext_data_control_manager_v1*>(
          wl_registry_bind(reg, name, ExtTraits::managerInterface(), ExtTraits::kVersion));
    } else if (std::strcmp(iface, zwlr_data_control_manager_v1_interface.name) == 0 &&
               version >= WlrTraits::kVersion) {
      self->wlrManager = static_cast<zwlr_data_control_manager_v1*>(
          wl_registry_bind(reg, name, WlrTraits::managerInterface(), WlrTraits::kVersion));
    }
  }
  static void onGlobalRemove(void*, wl_registry*, uint32_t) {}
};

WaylandPrimaryWatcher::WaylandPrimaryWatcher() : impl_(new Impl()) {}
WaylandPrimaryWatcher::~WaylandPrimaryWatcher() {
  close();
  delete impl_;
}

bool WaylandPrimaryWatcher::open() {
  Impl& s = *impl_;
  s.display = wl_display_connect(nullptr);
  if (!s.display) return false;
  static const wl_registry_listener regListener = {&Impl::onGlobal, &Impl::onGlobalRemove};
  s.registry = wl_display_get_registry(s.display);
  wl_registry_add_listener(s.registry, &regListener, &s);
  wl_display_roundtrip(s.display);
  if (!s.seat || (!s.extManager && !s.wlrManager)) {
    close();
    return false;
  }
  s.useExt = s.extManager != nullptr;
  if (s.useExt) s.bindDevice<ExtTraits>();
  else s.bindDevice<WlrTraits>();
  // Initial primary_selection arrives here; the caller seeds from it.
  wl_display_roundtrip(s.display);
  return true;
}

int WaylandPrimaryWatcher::fd() const { return impl_->display ? wl_display_get_fd(impl_->display) : -1; }

void WaylandPrimaryWatcher::prepare() {
  Impl& s = *impl_;
  if (!s.display || s.reading) return;
  while (wl_display_prepare_read(s.display) != 0) wl_display_dispatch_pending(s.display);
  wl_display_flush(s.display);
  s.reading = true;
}

bool WaylandPrimaryWatcher::dispatch(const TextFn& onChange) {
  Impl& s = *impl_;
  if (!s.display) return false;
  if (s.reading) {
    struct pollfd pfd = {wl_display_get_fd(s.display), POLLIN, 0};
    if (poll(&pfd, 1, 0) > 0 && (pfd.revents & POLLIN)) {
      if (wl_display_read_events(s.display) != 0) {
        s.reading = false;
        return false;
      }
    } else {
      wl_display_cancel_read(s.display);
    }
    s.reading = false;
  }
  if (wl_display_dispatch_pending(s.display) < 0) return false;
  if (s.useExt) s.deliver<ExtTraits>(onChange);
  else s.deliver<WlrTraits>(onChange);
  return !s.finished && wl_display_get_error(s.display) == 0;
}

void WaylandPrimaryWatcher::close() {
  Impl& s = *impl_;
  if (!s.display) return;
  if (s.reading) {
    wl_display_cancel_read(s.display);
    s.reading = false;
  }
  if (s.useExt) s.teardown<ExtTraits>();
  else s.teardown<WlrTraits>();
  if (s.extManager) ExtTraits::destroyManager(s.extManager);
  if (s.wlrManager) WlrTraits::destroyManager(s.wlrManager);
  s.extManager = nullptr;
  s.wlrManager = nullptr;
  if (s.seat) wl_seat_destroy(s.seat);
  s.seat = nullptr;
  if (s.registry) wl_registry_destroy(s.registry);
  s.registry = nullptr;
  wl_display_disconnect(s.display);
  s.display = nullptr;
}

const char* WaylandPrimaryWatcher::protocolName() const {
  if (impl_->extManager) return ExtTraits::name();
  if (impl_->wlrManager) return WlrTraits::name();
  return "none";
}

}  // namespace phevere
