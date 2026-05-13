param(
  [Parameter(Mandatory=$true)][string]$Jwt,
  [Parameter(Mandatory=$true)][string]$CompanyId,
  [int]$Uid = 12345,
  [ValidateSet('voice','video')][string]$Mode = 'video'
)

# Creates a company-scoped Agora channel name and requests RTC token from backend.
# Usage:
#   .\agora-token-test.ps1 -Jwt "<JWT>" -CompanyId "<companyId>" -Uid 12345 -Mode video

$channelKind = 'ch'
$channelName = "c_${CompanyId}_${channelKind}_test"

$body = @{ channelName = $channelName; uid = $Uid; role = 'publisher'; expireSeconds = 3600 } | ConvertTo-Json

try {
  $res = Invoke-RestMethod -Method Post -Uri "http://localhost:5000/api/agora/token" -Headers @{ Authorization = "Bearer $Jwt" } -ContentType "application/json" -Body $body -TimeoutSec 10
  $res | ConvertTo-Json -Depth 10
} catch {
  "FAILED: $($_.Exception.Message)"
  if ($_.Exception.Response -and $_.Exception.Response.GetResponseStream()) {
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $reader.ReadToEnd()
  }
}
