"""End-to-end API tests use a disposable SQLite database, never the user's demo data."""
from datetime import timedelta

from app.main import today_local


def future_weekday(days_ahead=1):
    day = today_local() + timedelta(days=days_ahead)
    while day.weekday() == 6:
        day += timedelta(days=1)
    return day.isoformat()


def test_health_and_bootstrap(client):
    health = client.get('/api/health')
    assert health.status_code == 200
    assert health.json()['catalog_items'] == 16
    assert 'BM25' in health.json()['retrieval']
    data = client.get('/api/bootstrap').json()
    assert data['wallet']['balance'] == 420.0
    assert len(data['providers']) == 7
    assert 'Cardiologia' in data['specialties']


def test_hybrid_cardio_search_budget_grounding(client):
    result = client.post('/api/search', json={
        'query':'Preciso de um check-up completo do coração perto da Avenida Paulista e quero gastar até R$ 300 usando meu saldo Exmed'
    })
    assert result.status_code == 200, result.text
    data = result.json()
    assert data['retrieval_method'] == 'hybrid_bm25_lsa_rrf'
    assert data['count'] >= 3
    assert data['intent']['budget'] == 300
    assert data['intent']['specialty'] == 'Cardiologia'
    assert data['intent']['use_balance'] is True
    for item in data['results']:
        assert item['specialty'] == 'Cardiologia'
        assert item['price'] <= 300
        assert item['source_id'] == f"catalog:service:{item['id']}"
        assert 'bm25' in item['retrieval'] and 'semantic_similarity' in item['retrieval']
        assert item['saving'] == round(item['original_price'] - item['price'], 2)
    assert data['summary']['citations'][0] == data['results'][0]['source_id']


def test_query_specialty_synonyms_and_filters(client):
    result = client.post('/api/search', json={'query':'Preciso consultar um dermatologista para minha pele', 'budget':200})
    assert result.status_code == 200
    assert result.json()['intent']['specialty'] == 'Dermatologia'
    assert result.json()['count'] == 0  # Prices for this specialty are above R$200.
    result = client.post('/api/search', json={'query':'Quero hemograma barato', 'budget':100})
    assert result.status_code == 200
    assert any('Hemograma' in s['title'] for s in result.json()['results'])
    assert all(s['price'] <= 100 for s in result.json()['results'])
    result = client.post('/api/search', json={'query':'coração', 'specialty':'Todas','budget':100000})
    assert result.status_code == 200
    assert len({x['specialty'] for x in result.json()['results']}) > 1


def test_sort_by_price(client):
    resp = client.post('/api/search', json={'query':'checkup do coração', 'sort':'price'})
    assert resp.status_code == 200
    prices = [r['price'] for r in resp.json()['results']]
    assert prices == sorted(prices)


def test_search_with_very_low_budget_returns_grounded_empty(client):
    data = client.post('/api/search', json={'query':'consulta coração', 'budget':1}).json()
    assert data['results'] == []
    assert data['summary']['estimated_total'] is None
    assert not data['summary']['citations']


def test_appointment_wallet_duplicate_cancel_and_refund(client):
    service = client.get('/api/services/104').json()['service']
    assert service['price'] == 200
    day = future_weekday()
    available = client.get('/api/slots', params={'service_id':104, 'day':day})
    assert available.status_code == 200
    assert any(s['available'] for s in available.json()['slots'])
    payload = {'service_id':104, 'date':day, 'time':'09:00', 'patient_name':'Pessoa de Teste',
               'patient_email':'teste@exemplo.com','payment_method':'wallet'}
    response = client.post('/api/appointments', json=payload)
    assert response.status_code == 201, response.text
    app_id=response.json()['id']
    assert response.json()['wallet']['balance'] == 220
    assert response.json()['demo'] is True
    duplicate = client.post('/api/appointments', json=payload)
    assert duplicate.status_code == 409
    assert client.get('/api/wallet').json()['balance'] == 220
    slots = client.get('/api/slots', params={'service_id':104,'day':day}).json()['slots']
    assert not next(s for s in slots if s['time']=='09:00')['available']
    assert any(a['id']==app_id for a in client.get('/api/appointments').json()['items'])
    cancelled = client.post(f'/api/appointments/{app_id}/cancel')
    assert cancelled.status_code == 200
    assert cancelled.json()['wallet']['balance']==420
    assert client.post(f'/api/appointments/{app_id}/cancel').status_code == 409
    available = client.get('/api/slots', params={'service_id':104,'day':day}).json()['slots']
    assert next(s for s in available if s['time']=='09:00')['available']


def test_insufficient_wallet_and_demo_payment(client):
    day = future_weekday()
    payload = {'service_id':105,'date':day,'time':'09:00','patient_name':'Pessoa de Teste','payment_method':'wallet'}
    # price is 287, can afford once, then not again at another slot.
    first=client.post('/api/appointments',json=payload)
    assert first.status_code==201
    payload['time']='10:30'
    assert client.post('/api/appointments',json=payload).status_code==409
    payload['payment_method']='demo'
    second=client.post('/api/appointments',json=payload)
    assert second.status_code==201
    assert second.json()['wallet']['balance']==133
    assert client.post(f"/api/appointments/{second.json()['id']}/cancel").json()['wallet']['balance']==133


def test_reject_invalid_date_and_provider_slot(client):
    payload = {'service_id':101,'date':(today_local()-timedelta(days=1)).isoformat(),
               'time':'09:00','patient_name':'Pessoa Teste','payment_method':'demo'}
    assert client.post('/api/appointments',json=payload).status_code==422
    payload['date']=future_weekday();payload['time']='04:00'
    assert client.post('/api/appointments',json=payload).status_code==422
    assert client.get('/api/services/99999').status_code==404
    assert client.get('/api/providers/9999/services').status_code==404


def test_frontend_available(client):
    index=client.get('/')
    assert index.status_code==200
    assert 'Concierge Inteligente' in index.text
    assert client.get('/assets/app.js').status_code==200
    assert client.get('/assets/styles.css').status_code==200


def test_same_provider_cannot_double_book_different_services(client):
    """Services 101 and 201 share provider 1: their agendas must share occupancy."""
    day = future_weekday()
    original = {'service_id':101, 'date':day, 'time':'13:00',
                'patient_name':'Cliente Fictício', 'payment_method':'demo'}
    first = client.post('/api/appointments', json=original)
    assert first.status_code == 201
    other = {**original, 'service_id':201, 'patient_name':'Outra Pessoa'}
    assert client.post('/api/appointments', json=other).status_code == 409
    assert client.post(f"/api/appointments/{first.json()['id']}/cancel").status_code == 200
    assert client.post('/api/appointments', json=other).status_code == 201


def test_sunday_closed_and_request_validation(client):
    sunday = today_local() + timedelta(days=(6-today_local().weekday()) % 7)
    response = client.get('/api/slots', params={'service_id':101,'day':sunday.isoformat()})
    assert response.status_code == 200
    assert response.json()['slots'] == []
    payload = {'service_id':101,'date':sunday.isoformat(),'time':'09:00',
               'patient_name':'Pessoa de Teste','payment_method':'demo'}
    assert client.post('/api/appointments',json=payload).status_code == 422
    invalid_search = client.post('/api/search',json={'query':'hemograma','sort':'invalid'})
    assert invalid_search.status_code == 422
