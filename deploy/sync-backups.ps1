# -----------------------------------------------------------
#  큐브티 백업 오프사이트 동기화 (서버 -> 이 PC)
#
#  서버 안의 백업은 서버가 죽으면 같이 사라진다. 물리적으로 다른 곳에
#  한 벌 더 둔다. DB 덤프는 전부 합쳐도 2MB 안팎이라 매일 받아도 부담이 없다.
#
#  수동 실행:  powershell -ExecutionPolicy Bypass -File sync-backups.ps1
#  자동 실행:  작업 스케줄러 (매일). PC가 꺼져 있던 날은 다음 실행 때 만회된다
#              - 최근 며칠치를 통째로 다시 받기 때문.
# -----------------------------------------------------------

$ErrorActionPreference = "Continue"

$Server  = "root@64.176.228.203"
$KeyFile = Join-Path $HOME ".ssh\qubetee_deploy"
$Dest    = Join-Path $HOME "Documents\큐브티백업"
$KeepDays = 60          # 이 PC에 보관할 일수
$LogFile = Join-Path $Dest "sync.log"

function Log($msg) {
    $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Write-Host $line
    Add-Content -Path $LogFile -Value $line -Encoding utf8
}

if (-not (Test-Path $Dest)) { New-Item -ItemType Directory -Path $Dest -Force | Out-Null }
if (-not (Test-Path $KeyFile)) { Log "SSH 키가 없습니다: $KeyFile"; exit 1 }

Log "=== 동기화 시작 ==="

# 서버가 응답하는지 먼저 본다. 죽어 있으면 조용히 끝낸다(다음 날 다시 시도).
$ping = & ssh -i $KeyFile -o ConnectTimeout=15 -o BatchMode=yes $Server "echo ok" 2>$null
if ($ping -ne "ok") { Log "서버에 접속할 수 없습니다 - 이번 회차 건너뜀"; exit 1 }

$totalFiles = 0

# --- 1) 직영 DB 덤프 ---------------------------------------
$dirDirect = Join-Path $Dest "직영"
if (-not (Test-Path $dirDirect)) { New-Item -ItemType Directory -Path $dirDirect -Force | Out-Null }

& scp -i $KeyFile -q "${Server}:/root/backups/qubetee-*.sql.gz" "$dirDirect\" 2>$null
if ($?) {
    $n = (Get-ChildItem $dirDirect -Filter *.sql.gz -ErrorAction SilentlyContinue).Count
    Log "직영 DB 덤프: $n 개 보유"
    $totalFiles += $n
} else {
    Log "직영 DB 덤프 받기 실패"
}

# --- 2) 고객사 DB 덤프 -------------------------------------
# 고객사마다 파일명이 날짜뿐이라 그대로 받으면 서로 덮어쓴다. 코드별 폴더로 나눈다.
$codes = & ssh -i $KeyFile -o BatchMode=yes $Server "ls -1 /opt/cubetee/customers/ 2>/dev/null" 2>$null
if ($codes) {
    foreach ($code in $codes) {
        $code = $code.Trim()
        if (-not $code) { continue }
        $dirCust = Join-Path $Dest "고객사\$code"
        if (-not (Test-Path $dirCust)) { New-Item -ItemType Directory -Path $dirCust -Force | Out-Null }
        & scp -i $KeyFile -q "${Server}:/opt/cubetee/customers/$code/backup/*.sql.gz" "$dirCust\" 2>$null
        $n = (Get-ChildItem $dirCust -Filter *.sql.gz -ErrorAction SilentlyContinue).Count
        Log "고객사 [$code]: $n 개 보유"
        $totalFiles += $n
    }
} else {
    Log "고객사 없음"
}

# --- 3) 제거된 고객사의 마지막 백업 -------------------------
# 지운 뒤에 "그거 좀 살려달라"는 요청이 오는 자리라 이것도 챙긴다.
$dirRemoved = Join-Path $Dest "제거된고객사"
if (-not (Test-Path $dirRemoved)) { New-Item -ItemType Directory -Path $dirRemoved -Force | Out-Null }
& scp -i $KeyFile -q "${Server}:/root/backups/removed-customers/*.sql.gz" "$dirRemoved\" 2>$null
$nRemoved = (Get-ChildItem $dirRemoved -Filter *.sql.gz -ErrorAction SilentlyContinue).Count
if ($nRemoved -gt 0) { Log "제거된 고객사 최종본: $nRemoved 개 보유" }

# --- 4) 무결성 확인 ----------------------------------------
# gzip 파일은 마지막 4바이트에 원본 크기가 들어 있다. 다 받지 못했으면 여기서 걸린다.
$broken = @()
Get-ChildItem $Dest -Recurse -Filter *.sql.gz -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.Length -lt 100) { $broken += $_.Name; return }
    try {
        $fs = [System.IO.File]::OpenRead($_.FullName)
        $gz = New-Object System.IO.Compression.GZipStream($fs, [System.IO.Compression.CompressionMode]::Decompress)
        $buf = New-Object byte[] 65536
        while ($gz.Read($buf, 0, $buf.Length) -gt 0) { }   # 끝까지 풀어본다
        $gz.Close(); $fs.Close()
    } catch {
        $broken += $_.Name
        if ($gz) { $gz.Dispose() }; if ($fs) { $fs.Dispose() }
    }
}
if ($broken.Count -gt 0) {
    Log "깨진 파일 $($broken.Count) 개: $($broken -join ', ')  <- 다음 회차에 다시 받는다"
} else {
    Log "무결성 확인 OK (전부 정상적으로 풀림)"
}

# --- 5) 오래된 사본 정리 ------------------------------------
$cutoff = (Get-Date).AddDays(-$KeepDays)
$old = Get-ChildItem $Dest -Recurse -Filter *.sql.gz -ErrorAction SilentlyContinue |
       Where-Object { $_.LastWriteTime -lt $cutoff }
if ($old) {
    $old | Remove-Item -Force -ErrorAction SilentlyContinue
    Log "$KeepDays 일 지난 사본 $($old.Count) 개 정리"
}

$size = (Get-ChildItem $Dest -Recurse -Filter *.sql.gz -ErrorAction SilentlyContinue |
         Measure-Object -Property Length -Sum).Sum
$sizeMB = [math]::Round($size / 1MB, 1)
Log "=== 완료: 파일 $totalFiles 개 / 총 $sizeMB MB / 위치 $Dest ==="
