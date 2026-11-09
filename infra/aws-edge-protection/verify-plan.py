"""AC1/AC5: reject any live plan that mutates existing shared ACL behavior."""
import json
import sys

plan = json.load(open(sys.argv[1]))
backup = json.load(open(sys.argv[2]))
changes = [c for c in plan.get('resource_changes', []) if c['change']['actions'] != ['no-op']]
assert len(changes) == 1, 'Expected exactly one existing ACL update'
change = changes[0]
assert change['address'] == 'aws_wafv2_web_acl.shared'
assert change['change']['actions'] == ['update'], 'No create/delete/replacement permitted'
after = change['change']['after']
assert after['id'] == backup['Id'] and after['name'] == backup['Name']
assert after['scope'] == 'CLOUDFRONT'
rules = json.loads(after['rule_json'])
assert rules[:5] == backup['Rules'], 'Existing rules changed'
assert len(rules) == 7
assert after['tags'] == {} and after.get('tags_all', {}) == {}
assert len(after['default_action'][0]['allow']) == 1
visibility = after['visibility_config'][0]
assert visibility == {
    'cloudwatch_metrics_enabled': backup['VisibilityConfig']['CloudWatchMetricsEnabled'],
    'sampled_requests_enabled': backup['VisibilityConfig']['SampledRequestsEnabled'],
    'metric_name': backup['VisibilityConfig']['MetricName'],
}
print('PASS: only existing ACL updates; five original rules/default/visibility/tags preserved')
