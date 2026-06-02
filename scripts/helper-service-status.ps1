param(
  [string]$ServiceName = "LaraboxsHelper"
)

Get-Service -Name $ServiceName -ErrorAction SilentlyContinue |
  Select-Object Name, DisplayName, Status, StartType
