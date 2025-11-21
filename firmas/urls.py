from django.urls import path
from . import views

app_name = 'firmas'

urlpatterns = [
    path('', views.index, name='index'),
    path('api/signatures/upload/', views.upload_signature, name='upload_signature'),
    path('api/ping/', views.ping, name='ping'),
]
