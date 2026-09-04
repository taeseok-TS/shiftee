#!/bin/sh
# 앱 포트(3000) 외부 노출 차단 (2026-09-03 신설, 09-04 네 차례 보완)
#
# Docker 가 published port 용 iptables 규칙을 직접 넣어 **ufw 로는 안 막힌다**(IPv4).
# ufw status 에 22/80/443 만 보여 막힌 것처럼 착각하기 쉽다 - 실제로는 열려 있었다.
#
# ⚠ set -e 를 쓰지 않는다. 앞쪽 조작이 실패하면 뒤쪽의 유효한 방어가 영영 안 들어간다.

# ⚠ NIC 이름 하드코딩은 스냅샷 복원.인스턴스 변경 때 "규칙은 있는데 아무것도 안 막는"
#   조용한 실패가 된다. `awk {print $5}` 도 `default dev eth0 scope link` 에서 엉뚱한
#   토큰을 집는다. **dev 다음 토큰**을 집고 실재 장치인지 확인한다.
#   ECMP(nexthop 여러 개)면 모두 막는다 - 하나만 막으면 나머지가 무방비다.
IFACES=$(ip -o -4 route show default 2>/dev/null | tr ' ' '\n' | awk '/^dev$/{f=1;next} f{print;f=0}' | sort -u)
[ -n "$IFACES" ] || IFACES=$(ip -o -4 route show default 2>/dev/null | awk '{for(i=1;i<NF;i++) if($i=="dev"){print $(i+1)}}' | sort -u)
if [ -z "$IFACES" ]; then
  echo "외부 인터페이스를 찾지 못했다 - 규칙을 넣지 않는다" >&2
  exit 1
fi

# ⚠ `-C` 는 "체인 어딘가에 있나"만 본다. 1번 자리에 ACCEPT/RETURN 이 끼면 우리 DROP 이
#   뒤로 밀려도 -C 가 성공해 자가복구가 침묵한다. **1번 줄을 정확히 대조**한다.
ensure_first() {
  BIN=$1; CHAIN=$2; IF=$3
  WANT="-A $CHAIN -i $IF -p tcp -m tcp --dport 3000 -j DROP"
  FIRST=$($BIN -S "$CHAIN" 2>/dev/null | sed -n '2p')
  [ "$FIRST" = "$WANT" ] && return 0
  $BIN -D "$CHAIN" -i "$IF" -p tcp --dport 3000 -j DROP 2>/dev/null
  $BIN -I "$CHAIN" 1 -i "$IF" -p tcp --dport 3000 -j DROP
}

RC=0
for IFACE in $IFACES; do
  [ -e "/sys/class/net/$IFACE" ] || continue
  # ① IPv6 INPUT - **실제로 막는 것은 이것뿐이다.** 도커가 v6 DNAT 을 안 만들어
  #    외부 v6 패킷은 FORWARD 가 아니라 INPUT 으로 온다. 가장 먼저 넣는다.
  ensure_first ip6tables INPUT "$IFACE" || RC=1
  # ② IPv4 DOCKER-USER - 도커가 DNAT 하므로 FORWARD 를 탄다
  ensure_first iptables DOCKER-USER "$IFACE" || RC=1
  # ③ IPv6 DOCKER-USER - 지금은 발동 안 하지만(카운터 0) 브리지에 IPv6 가 붙으면 유효해진다.
  #    실패해도 위 둘을 무효로 만들지 않는다.
  ip6tables -C DOCKER-USER -i "$IFACE" -p tcp --dport 3000 -j DROP 2>/dev/null \
    || ip6tables -I DOCKER-USER 1 -i "$IFACE" -p tcp --dport 3000 -j DROP 2>/dev/null || true
done

# 옛 규칙(! -i lo)이 남아 있으면 걷어낸다
for BIN in iptables ip6tables; do
  $BIN -D DOCKER-USER -p tcp --dport 3000 ! -i lo -j DROP 2>/dev/null || true
done
exit $RC
