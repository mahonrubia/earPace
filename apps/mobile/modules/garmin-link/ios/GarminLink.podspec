Pod::Spec.new do |s|
  s.name           = 'GarminLink'
  s.version        = '0.1.0'
  s.summary        = 'Puente con relojes Garmin mediante Connect IQ Mobile SDK'
  s.description    = 'Envía y recibe mensajes entre la app Pinganillo y su app de reloj Connect IQ.'
  s.license        = 'MIT'
  s.author         = 'Pinganillo'
  s.homepage       = 'https://developer.garmin.com/connect-iq/'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '*.{h,m,swift}'
  # Descarga ConnectIQ.xcframework del SDK oficial de Garmin
  # (github.com/garmin/connectiq-companion-app-sdk-ios) y cópialo en esta carpeta.
  s.vendored_frameworks = 'ConnectIQ.xcframework'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
