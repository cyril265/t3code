#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>

#ifndef RENAME_NOREPLACE
#define RENAME_NOREPLACE 1
#endif

void __clear_cache(void *start, void *end) {
  uint64_t ctr;
  __asm__ volatile("mrs %0, ctr_el0" : "=r"(ctr));
  uintptr_t dline = 4u << ((ctr >> 16) & 15), iline = 4u << (ctr & 15);
  uintptr_t first = (uintptr_t)start, last = (uintptr_t)end, at;
  for (at = first & ~(dline - 1); at < last; at += dline) __asm__ volatile("dc cvau, %0" ::"r"(at) : "memory");
  __asm__ volatile("dsb ish" ::: "memory");
  for (at = first & ~(iline - 1); at < last; at += iline) __asm__ volatile("ic ivau, %0" ::"r"(at) : "memory");
  __asm__ volatile("dsb ish\n\tisb" ::: "memory");
}

static int copy_into(int src, int dst) {
  char buf[65536];
  for (;;) {
    ssize_t got = read(src, buf, sizeof buf);
    if (got == 0) return 0;
    if (got < 0) {
      if (errno == EINTR) continue;
      return -1;
    }
    for (ssize_t off = 0; off < got;) {
      ssize_t put = write(dst, buf + off, (size_t)(got - off));
      if (put < 0) {
        if (errno == EINTR) continue;
        return -1;
      }
      off += put;
    }
  }
}

static int publish_copy(int olddirfd, const char *oldpath, int newdirfd, const char *newpath, int flags) {
  static unsigned counter;
  int src = openat(olddirfd, oldpath, O_RDONLY | O_CLOEXEC | ((flags & AT_SYMLINK_FOLLOW) ? 0 : O_NOFOLLOW));
  if (src < 0) return -1;
  struct stat st;
  if (fstat(src, &st) < 0) {
    int error = errno;
    close(src);
    errno = error;
    return -1;
  }
  if (!S_ISREG(st.st_mode)) {
    close(src);
    errno = EPERM;
    return -1;
  }
  char tmp[4096];
  int dst = -1;
  for (int attempt = 0; dst < 0 && attempt < 16; attempt++) {
    unsigned n = __atomic_fetch_add(&counter, 1, __ATOMIC_RELAXED);
    if (snprintf(tmp, sizeof tmp, "%s.t3-link-%d-%u", newpath, getpid(), n) >= (int)sizeof tmp) {
      close(src);
      errno = ENAMETOOLONG;
      return -1;
    }
    dst = openat(newdirfd, tmp, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, st.st_mode & 07777);
    if (dst < 0 && errno != EEXIST) {
      int error = errno;
      close(src);
      errno = error;
      return -1;
    }
  }
  if (dst < 0) {
    close(src);
    errno = EAGAIN;
    return -1;
  }
  int error = 0;
  if (copy_into(src, dst) < 0 || fsync(dst) < 0) error = errno;
  close(src);
  close(dst);
  if (!error && syscall(SYS_renameat2, newdirfd, tmp, newdirfd, newpath, RENAME_NOREPLACE) == 0) return 0;
  if (!error) error = errno;
  unlinkat(newdirfd, tmp, 0);
  errno = error;
  return -1;
}

int linkat(int olddirfd, const char *oldpath, int newdirfd, const char *newpath, int flags) {
  if (syscall(SYS_linkat, olddirfd, oldpath, newdirfd, newpath, flags) == 0) return 0;
  int denied = errno;
  if (denied != EACCES && denied != EPERM) return -1;
  if (publish_copy(olddirfd, oldpath, newdirfd, newpath, flags) == 0) return 0;
  if (errno == ELOOP) errno = denied;
  return -1;
}

int link(const char *oldpath, const char *newpath) {
  return linkat(AT_FDCWD, oldpath, AT_FDCWD, newpath, 0);
}
