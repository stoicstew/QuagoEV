import { useState } from 'react';
import { getAutomations, saveAutomations, type AutomationRule } from '../utils/storage';

type TriggerType = AutomationRule['trigger']['type'];
type ConditionType = NonNullable<AutomationRule['condition']>['type'];
type ActionType = AutomationRule['action']['type'];

const TRIGGER_LABELS: Record<TriggerType, string> = {
  time: 'Time of Day',
  location: 'Location Arrival/Departure',
  battery: 'Battery Level Threshold',
  plugged_in: 'Plugged In Status',
};

const CONDITION_LABELS: Record<ConditionType, string> = {
  location: 'Location (home/work/other)',
  day_of_week: 'Day of Week',
  battery_level: 'Battery Level',
};

const ACTION_LABELS: Record<ActionType, string> = {
  notify: 'Send Notification',
  climate_on: 'Turn Climate On',
  climate_off: 'Turn Climate Off',
  charge_start: 'Start Charging',
  charge_stop: 'Stop Charging',
};

const TEMPLATES: Omit<AutomationRule, 'id'>[] = [
  {
    name: 'Forgot to Plug In',
    enabled: true,
    trigger: { type: 'time', value: '21:00' },
    condition: { type: 'location', value: 'home' },
    action: {
      type: 'notify',
      params: { message: 'Your car is at home and not plugged in!' },
    },
  },
  {
    name: 'Weekday Commute Cool',
    enabled: true,
    trigger: { type: 'time', value: '16:45' },
    condition: { type: 'day_of_week', value: 'Mon,Tue,Wed,Thu,Fri' },
    action: {
      type: 'climate_on',
      params: { targetTemp: 72, location: 'work' },
    },
  },
  {
    name: 'Low Battery Alert',
    enabled: true,
    trigger: { type: 'battery', value: '20' },
    action: {
      type: 'notify',
      params: { message: 'Battery has dropped below 20%!' },
    },
  },
  {
    name: 'Overnight Charging',
    enabled: true,
    trigger: { type: 'time', value: '00:00' },
    condition: { type: 'location', value: 'home' },
    action: { type: 'charge_start' },
  },
];

const TEMPLATE_DESCRIPTIONS: Record<string, string> = {
  'Forgot to Plug In': 'Notify if at home after 9 PM and not plugged in',
  'Weekday Commute Cool': 'Turn on AC at 4:45 PM on weekdays if at work',
  'Low Battery Alert': 'Notify when battery drops below 20%',
  'Overnight Charging': 'Start charging at midnight if plugged in at home',
};

function generateId(): string {
  return `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

interface RuleFormState {
  name: string;
  triggerType: TriggerType;
  triggerValue: string;
  hasCondition: boolean;
  conditionType: ConditionType;
  conditionValue: string;
  actionType: ActionType;
  actionTargetTemp: string;
  actionMessage: string;
}

const EMPTY_FORM: RuleFormState = {
  name: '',
  triggerType: 'time',
  triggerValue: '',
  hasCondition: false,
  conditionType: 'location',
  conditionValue: '',
  actionType: 'notify',
  actionTargetTemp: '72',
  actionMessage: '',
};

function ruleToFormState(rule: AutomationRule): RuleFormState {
  return {
    name: rule.name,
    triggerType: rule.trigger.type,
    triggerValue: rule.trigger.value,
    hasCondition: !!rule.condition,
    conditionType: rule.condition?.type ?? 'location',
    conditionValue: rule.condition?.value ?? '',
    actionType: rule.action.type,
    actionTargetTemp: String(rule.action.params?.targetTemp ?? '72'),
    actionMessage: String(rule.action.params?.message ?? ''),
  };
}

function formStateToRule(form: RuleFormState, existingId?: string): AutomationRule {
  const rule: AutomationRule = {
    id: existingId ?? generateId(),
    name: form.name,
    enabled: true,
    trigger: { type: form.triggerType, value: form.triggerValue },
    action: { type: form.actionType },
  };

  if (form.hasCondition && form.conditionValue) {
    rule.condition = { type: form.conditionType, value: form.conditionValue };
  }

  if (form.actionType === 'climate_on' && form.actionTargetTemp) {
    rule.action.params = { targetTemp: Number(form.actionTargetTemp) };
  }
  if (form.actionType === 'notify' && form.actionMessage) {
    rule.action.params = { message: form.actionMessage };
  }

  return rule;
}

export default function Automations() {
  const [rules, setRules] = useState<AutomationRule[]>(getAutomations);
  const [showForm, setShowForm] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [form, setForm] = useState<RuleFormState>(EMPTY_FORM);
  const [showTemplates, setShowTemplates] = useState(false);

  function persist(updated: AutomationRule[]) {
    setRules(updated);
    saveAutomations(updated);
  }

  function handleToggle(id: string) {
    const updated = rules.map((r) =>
      r.id === id ? { ...r, enabled: !r.enabled } : r,
    );
    persist(updated);
  }

  function handleDelete(id: string) {
    persist(rules.filter((r) => r.id !== id));
  }

  function handleEdit(rule: AutomationRule) {
    setForm(ruleToFormState(rule));
    setEditingRuleId(rule.id);
    setShowForm(true);
    setShowTemplates(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.triggerValue.trim()) return;

    if (editingRuleId) {
      const existingRule = rules.find((r) => r.id === editingRuleId);
      const updated = rules.map((r) =>
        r.id === editingRuleId
          ? { ...formStateToRule(form, editingRuleId), enabled: existingRule?.enabled ?? true }
          : r,
      );
      persist(updated);
    } else {
      persist([...rules, formStateToRule(form)]);
    }

    setForm(EMPTY_FORM);
    setEditingRuleId(null);
    setShowForm(false);
  }

  function handleCancel() {
    setForm(EMPTY_FORM);
    setEditingRuleId(null);
    setShowForm(false);
  }

  function handleAddTemplate(template: Omit<AutomationRule, 'id'>) {
    const newRule: AutomationRule = { ...template, id: generateId() };
    persist([...rules, newRule]);
  }

  function updateForm(patch: Partial<RuleFormState>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  function renderTriggerValueInput() {
    switch (form.triggerType) {
      case 'time':
        return (
          <input
            type="time"
            className="form-input"
            value={form.triggerValue}
            onChange={(e) => updateForm({ triggerValue: e.target.value })}
            required
          />
        );
      case 'location':
        return (
          <select
            className="form-select"
            value={form.triggerValue}
            onChange={(e) => updateForm({ triggerValue: e.target.value })}
            required
          >
            <option value="">Select location event</option>
            <option value="arrive_home">Arrive Home</option>
            <option value="depart_home">Depart Home</option>
            <option value="arrive_work">Arrive Work</option>
            <option value="depart_work">Depart Work</option>
          </select>
        );
      case 'battery':
        return (
          <div className="input-with-suffix">
            <input
              type="number"
              className="form-input"
              min={1}
              max={100}
              placeholder="e.g. 20"
              value={form.triggerValue}
              onChange={(e) => updateForm({ triggerValue: e.target.value })}
              required
            />
            <span className="input-suffix">%</span>
          </div>
        );
      case 'plugged_in':
        return (
          <select
            className="form-select"
            value={form.triggerValue}
            onChange={(e) => updateForm({ triggerValue: e.target.value })}
            required
          >
            <option value="">Select status</option>
            <option value="plugged">Plugged In</option>
            <option value="unplugged">Unplugged</option>
          </select>
        );
    }
  }

  function renderConditionValueInput() {
    switch (form.conditionType) {
      case 'location':
        return (
          <select
            className="form-select"
            value={form.conditionValue}
            onChange={(e) => updateForm({ conditionValue: e.target.value })}
          >
            <option value="">Select location</option>
            <option value="home">Home</option>
            <option value="work">Work</option>
            <option value="other">Other</option>
          </select>
        );
      case 'day_of_week':
        return (
          <input
            type="text"
            className="form-input"
            placeholder="e.g. Mon,Tue,Wed,Thu,Fri"
            value={form.conditionValue}
            onChange={(e) => updateForm({ conditionValue: e.target.value })}
          />
        );
      case 'battery_level':
        return (
          <div className="input-with-suffix">
            <input
              type="number"
              className="form-input"
              min={1}
              max={100}
              placeholder="e.g. 50"
              value={form.conditionValue}
              onChange={(e) => updateForm({ conditionValue: e.target.value })}
            />
            <span className="input-suffix">%</span>
          </div>
        );
    }
  }

  function renderActionParams() {
    if (form.actionType === 'climate_on') {
      return (
        <div className="form-group">
          <label className="form-label">Target Temperature</label>
          <div className="input-with-suffix">
            <input
              type="number"
              className="form-input"
              min={60}
              max={90}
              value={form.actionTargetTemp}
              onChange={(e) => updateForm({ actionTargetTemp: e.target.value })}
            />
            <span className="input-suffix">°F</span>
          </div>
        </div>
      );
    }
    if (form.actionType === 'notify') {
      return (
        <div className="form-group">
          <label className="form-label">Notification Message</label>
          <input
            type="text"
            className="form-input"
            placeholder="Custom notification message"
            value={form.actionMessage}
            onChange={(e) => updateForm({ actionMessage: e.target.value })}
          />
        </div>
      );
    }
    return null;
  }

  function formatTrigger(rule: AutomationRule): string {
    const { type, value } = rule.trigger;
    switch (type) {
      case 'time':
        return `At ${value}`;
      case 'location':
        return value.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      case 'battery':
        return `Battery at ${value}%`;
      case 'plugged_in':
        return value === 'plugged' ? 'When plugged in' : 'When unplugged';
    }
  }

  function formatCondition(rule: AutomationRule): string | null {
    if (!rule.condition) return null;
    const { type, value } = rule.condition;
    switch (type) {
      case 'location':
        return `at ${value}`;
      case 'day_of_week':
        return `on ${value}`;
      case 'battery_level':
        return `battery ${value}%`;
    }
  }

  function formatAction(rule: AutomationRule): string {
    switch (rule.action.type) {
      case 'notify':
        return 'Send notification';
      case 'climate_on':
        return rule.action.params?.targetTemp
          ? `Climate on (${rule.action.params.targetTemp}°F)`
          : 'Climate on';
      case 'climate_off':
        return 'Climate off';
      case 'charge_start':
        return 'Start charging';
      case 'charge_stop':
        return 'Stop charging';
    }
  }

  return (
    <div className="automations">
      <div className="page-header">
        <h1 className="page-title">Smart Automations</h1>
        <p className="page-subtitle">
          Create rules to automate your vehicle based on time, location, and battery status.
        </p>
      </div>

      {/* Templates Section */}
      <section className="automations-section">
        <button
          className="btn btn-secondary"
          onClick={() => setShowTemplates(!showTemplates)}
        >
          {showTemplates ? 'Hide Templates' : 'Quick-Add Templates'}
        </button>

        {showTemplates && (
          <div className="templates-grid">
            {TEMPLATES.map((template) => {
              const alreadyAdded = rules.some((r) => r.name === template.name);
              return (
                <div key={template.name} className="template-card">
                  <div className="template-card-header">
                    <h3 className="template-card-title">{template.name}</h3>
                  </div>
                  <p className="template-card-description">
                    {TEMPLATE_DESCRIPTIONS[template.name]}
                  </p>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={alreadyAdded}
                    onClick={() => handleAddTemplate(template)}
                  >
                    {alreadyAdded ? 'Already Added' : 'Add Rule'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Rules List */}
      <section className="automations-section">
        <div className="section-header">
          <h2 className="section-title">
            Your Rules {rules.length > 0 && <span className="badge">{rules.length}</span>}
          </h2>
          <button
            className="btn btn-primary"
            onClick={() => {
              setForm(EMPTY_FORM);
              setEditingRuleId(null);
              setShowForm(true);
              setShowTemplates(false);
            }}
          >
            Create Automation
          </button>
        </div>

        {rules.length === 0 && !showForm && (
          <div className="empty-state">
            <p className="empty-state-text">
              No automation rules yet. Create one or pick a template to get started.
            </p>
          </div>
        )}

        <div className="rules-list">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className={`rule-card ${rule.enabled ? '' : 'rule-card-disabled'}`}
            >
              <div className="rule-card-main">
                <div className="rule-card-info">
                  <h3 className="rule-card-name">{rule.name}</h3>
                  <p className="rule-card-summary">
                    <span className="rule-tag rule-tag-trigger">
                      {formatTrigger(rule)}
                    </span>
                    {formatCondition(rule) && (
                      <span className="rule-tag rule-tag-condition">
                        {formatCondition(rule)}
                      </span>
                    )}
                    <span className="rule-tag rule-tag-action">
                      {formatAction(rule)}
                    </span>
                  </p>
                </div>
                <div className="rule-card-controls">
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={() => handleToggle(rule.id)}
                    />
                    <span className="toggle-slider" />
                  </label>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleEdit(rule)}
                    title="Edit rule"
                  >
                    Edit
                  </button>
                  <button
                    className="btn btn-ghost btn-sm btn-danger"
                    onClick={() => handleDelete(rule.id)}
                    title="Delete rule"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Create / Edit Form */}
      {showForm && (
        <div className="rule-form-overlay">
          <form className="rule-form" onSubmit={handleSubmit}>
            <h2 className="rule-form-title">
              {editingRuleId ? 'Edit Automation' : 'Create Automation'}
            </h2>

            <div className="form-group">
              <label className="form-label">Rule Name</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. Morning Pre-cool"
                value={form.name}
                onChange={(e) => updateForm({ name: e.target.value })}
                required
              />
            </div>

            <fieldset className="form-fieldset">
              <legend className="form-legend">Trigger</legend>
              <div className="form-group">
                <label className="form-label">When this happens</label>
                <select
                  className="form-select"
                  value={form.triggerType}
                  onChange={(e) =>
                    updateForm({ triggerType: e.target.value as TriggerType, triggerValue: '' })
                  }
                >
                  {Object.entries(TRIGGER_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Trigger Value</label>
                {renderTriggerValueInput()}
              </div>
            </fieldset>

            <fieldset className="form-fieldset">
              <legend className="form-legend">Condition (Optional)</legend>
              <div className="form-group">
                <label className="toggle-inline">
                  <input
                    type="checkbox"
                    checked={form.hasCondition}
                    onChange={(e) =>
                      updateForm({ hasCondition: e.target.checked, conditionValue: '' })
                    }
                  />
                  <span>Add a condition</span>
                </label>
              </div>
              {form.hasCondition && (
                <>
                  <div className="form-group">
                    <label className="form-label">Only if</label>
                    <select
                      className="form-select"
                      value={form.conditionType}
                      onChange={(e) =>
                        updateForm({
                          conditionType: e.target.value as ConditionType,
                          conditionValue: '',
                        })
                      }
                    >
                      {Object.entries(CONDITION_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Condition Value</label>
                    {renderConditionValueInput()}
                  </div>
                </>
              )}
            </fieldset>

            <fieldset className="form-fieldset">
              <legend className="form-legend">Action</legend>
              <div className="form-group">
                <label className="form-label">Then do this</label>
                <select
                  className="form-select"
                  value={form.actionType}
                  onChange={(e) => updateForm({ actionType: e.target.value as ActionType })}
                >
                  {Object.entries(ACTION_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              {renderActionParams()}
            </fieldset>

            <div className="form-actions">
              <button type="button" className="btn btn-secondary" onClick={handleCancel}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                {editingRuleId ? 'Save Changes' : 'Create Rule'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
